import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Dimensions,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Brightness from 'expo-brightness';
import * as ImagePicker from 'expo-image-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VolumeManager } from 'react-native-volume-manager';
import {
  Camera,
  type CameraDevice,
  type Constraint,
  type Recorder,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
  useVideoOutput,
} from 'react-native-vision-camera';
import LockScreenCover, { type LockSurface } from './components/LockScreenCover';
import TextPresetEditor from './components/TextPresetEditor';
import {
  BRIGHTNESS_VALUE,
  type BrightnessId,
  type CoverPreset,
  DEFAULT_SETTINGS,
  type FitId,
  type FpsId,
  type LensId,
  loadSettings,
  newTextPreset,
  persistCoverImage,
  persistHomeShot,
  persistLockWallpaper,
  type ResolutionId,
  RESOLUTION_SIZE,
  saveSettings,
  type Settings,
  type TextPreset,
} from './settings';

type Phase = 'idle' | 'starting' | 'recording' | 'stopping';

const FPS_OPTIONS: FpsId[] = [24, 30, 60];

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Something went wrong.';
}

function includesLens(device: CameraDevice | undefined, lens: 'ultra-wide-angle' | 'wide-angle'): boolean {
  if (!device) {
    return false;
  }
  if (device.type === lens) {
    return true;
  }
  return device.physicalDevices.some((item) => item.type === lens);
}

function zoomFor(device: CameraDevice, lens: LensId): number | undefined {
  if (lens === 'front') {
    return undefined;
  }
  const switchZoom = device.zoomLensSwitchFactors.find((value) => value > device.minZoom + 0.05);
  if (lens === 'ultra') {
    if (includesLens(device, 'ultra-wide-angle') && switchZoom != null) {
      return device.minZoom;
    }
    return undefined;
  }
  return switchZoom;
}

async function saveVideoToPhotos(path: string): Promise<void> {
  const permission = await requestPermissionsAsync(true, ['video']);
  if (!permission.granted) {
    throw new Error('Photos access was denied. Allow Stage Cover to add photos, then tap Save to Photos.');
  }
  const uri = path.startsWith('file://') ? path : `file://${path}`;
  await Asset.create(uri);
}

function coverReady(settings: Settings): boolean {
  if (settings.coverPreset === 'black') {
    return true;
  }
  if (settings.coverPreset === 'image') {
    return Boolean(settings.coverUri);
  }
  if (settings.coverPreset === 'text') {
    return Boolean(settings.activeTextPresetId && settings.textPresets.some((item) => item.id === settings.activeTextPresetId));
  }
  return Boolean(settings.lockWallpaperUri || settings.homeShotUri);
}

export default function StageCover() {
  const cameraPermission = useCameraPermission();
  const microphonePermission = useMicrophonePermission();
  const wideDevice = useCameraDevice('back', {
    physicalDevices: ['ultra-wide-angle', 'wide-angle'],
  });
  const wideOnlyDevice = useCameraDevice('back', { physicalDevices: ['wide-angle'] });
  const ultraOnlyDevice = useCameraDevice('back', { physicalDevices: ['ultra-wide-angle'] });
  const frontDevice = useCameraDevice('front');

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [cameraReady, setCameraReady] = useState(false);
  const [appActive, setAppActive] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [activeFps, setActiveFps] = useState<number | null>(null);
  const [unsavedPath, setUnsavedPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDraft, setEditorDraft] = useState<TextPreset | null>(null);
  const [lockSurface, setLockSurface] = useState<LockSurface>('lock');
  const lastLitSurfaceRef = useRef<Exclude<LockSurface, 'off'>>('lock');

  const phaseRef = useRef<Phase>('idle');
  const settingsRef = useRef(settings);
  const lockSurfaceRef = useRef<LockSurface>('lock');
  const recorderRef = useRef<Recorder | null>(null);
  const cancelRef = useRef(false);
  const releaseVolumeRef = useRef<(() => Promise<void>) | null>(null);
  const previousVolumeRef = useRef<number | null>(null);
  const previousBrightnessRef = useRef<number | null>(null);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const powerRef = useRef<() => void>(() => {});
  const videoOutputRef = useRef<ReturnType<typeof useVideoOutput> | null>(null);
  const handledRef = useRef(false);
  const stopWatchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  settingsRef.current = settings;
  lockSurfaceRef.current = lockSurface;

  const device = useMemo(() => {
    if (settings.lens === 'front') {
      return frontDevice;
    }
    if (settings.lens === 'ultra') {
      if (includesLens(wideDevice, 'ultra-wide-angle')) {
        return wideDevice;
      }
      return ultraOnlyDevice ?? wideDevice ?? wideOnlyDevice;
    }
    if (includesLens(wideDevice, 'wide-angle')) {
      return wideDevice;
    }
    return wideOnlyDevice ?? wideDevice;
  }, [frontDevice, settings.lens, ultraOnlyDevice, wideDevice, wideOnlyDevice]);

  const zoom = device ? zoomFor(device, settings.lens) : undefined;
  const videoOutput = useVideoOutput({
    targetResolution: RESOLUTION_SIZE[settings.resolution],
    enableAudio: settings.mic,
    fileType: 'mp4',
  });
  videoOutputRef.current = videoOutput;

  const constraints = useMemo<Constraint[]>(
    () => [
      { resolutionBias: videoOutput },
      { fps: settings.fps },
      { videoStabilizationMode: 'standard' },
    ],
    [settings.fps, videoOutput],
  );

  const covering = phase !== 'idle';
  const torchOn = settings.flash && settings.lens !== 'front' && device?.hasTorch === true;
  const activeText = settings.textPresets.find((item) => item.id === settings.activeTextPresetId) ?? null;
  const canRecord = coverReady(settings);
  const previewVisible = settings.showPreview || covering;

  function setPhase(next: Phase) {
    phaseRef.current = next;
    setPhaseState(next);
  }

  useEffect(() => {
    let alive = true;
    loadSettings().then((stored) => {
      if (!alive) {
        return;
      }
      setSettings(stored);
      setSettingsReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!settingsReady) {
      return;
    }
    saveSettings(settings).catch(() => {});
  }, [settings, settingsReady]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      setAppActive(active);
      if (!active) {
        void stopRef.current();
      }
    });
    return () => subscription.remove();
  }, []);

  async function finishCover() {
    const release = releaseVolumeRef.current;
    releaseVolumeRef.current = null;
    if (release) {
      await release().catch(() => {});
    }
    if (previousBrightnessRef.current != null) {
      await Brightness.setBrightnessAsync(previousBrightnessRef.current).catch(() => {});
      previousBrightnessRef.current = null;
    }
    await deactivateKeepAwake().catch(() => {});
    setLockSurface('lock');
    lastLitSurfaceRef.current = 'lock';
  }

  powerRef.current = () => {
    if (settingsRef.current.coverPreset !== 'lock') {
      return;
    }
    setLockSurface((current) => {
      if (current === 'off') {
        void Brightness.setBrightnessAsync(BRIGHTNESS_VALUE[settingsRef.current.brightness]);
        return lastLitSurfaceRef.current;
      }
      lastLitSurfaceRef.current = current;
      void Brightness.setBrightnessAsync(0);
      return 'off';
    });
  };

  async function armVolumeButtons() {
    const current = await VolumeManager.getVolume();
    previousVolumeRef.current = current.volume;
    let armed = false;
    let lastVolume = 0.5;
    const subscription = VolumeManager.addVolumeListener((result) => {
      if (!armed) {
        lastVolume = result.volume;
        return;
      }
      const goingUp = result.volume > lastVolume + 0.001 || (lastVolume >= 0.99 && result.volume >= 0.99);
      const goingDown = result.volume < lastVolume - 0.001 || (lastVolume <= 0.01 && result.volume <= 0.01);
      lastVolume = result.volume;
      const lockMode = settingsRef.current.coverPreset === 'lock';
      if (lockMode && goingUp) {
        powerRef.current();
        return;
      }
      if (goingDown || !lockMode) {
        void stopRef.current();
      }
    });
    await VolumeManager.showNativeVolumeUI({ enabled: false });
    if (Math.abs(current.volume - 0.5) > 0.02) {
      await VolumeManager.setVolume(0.5, { showUI: false, playSound: false });
    }
    lastVolume = 0.5;
    const armTimer = setTimeout(() => {
      armed = true;
    }, 450);
    releaseVolumeRef.current = async () => {
      clearTimeout(armTimer);
      armed = false;
      subscription.remove();
      if (previousVolumeRef.current != null) {
        await VolumeManager.setVolume(previousVolumeRef.current, {
          showUI: false,
          playSound: false,
        }).catch(() => {});
        previousVolumeRef.current = null;
      }
      await VolumeManager.showNativeVolumeUI({ enabled: true }).catch(() => {});
    };
  }

  function clearStopWatch() {
    if (stopWatchRef.current) {
      clearTimeout(stopWatchRef.current);
      stopWatchRef.current = null;
    }
  }

  async function storeFinishedVideo(path: string) {
    if (handledRef.current) {
      return;
    }
    handledRef.current = true;
    clearStopWatch();
    setSaving(true);
    try {
      await saveVideoToPhotos(path);
      setUnsavedPath(null);
      setMessage('Saved to Photos. Open the Photos app to watch it.');
    } catch (error) {
      setUnsavedPath(path);
      setMessage(errorText(error));
    } finally {
      setSaving(false);
      setPhase('idle');
      await finishCover();
    }
  }

  stopRef.current = async () => {
    const current = phaseRef.current;
    if (current === 'idle' || current === 'stopping') {
      return;
    }
    cancelRef.current = true;
    setPhase('stopping');
    const recorder = recorderRef.current;
    try {
      if (recorder?.isRecording) {
        clearStopWatch();
        stopWatchRef.current = setTimeout(() => {
          if (phaseRef.current !== 'stopping' || handledRef.current) {
            return;
          }
          handledRef.current = true;
          recorderRef.current = null;
          setPhase('idle');
          setMessage('Recording stopped. If the video is missing from Photos, run a short test at home.');
          void finishCover();
        }, 20000);
        await recorder.stopRecording();
        return;
      }
    } catch (error) {
      clearStopWatch();
      setMessage(errorText(error));
    }
    if (current === 'starting') {
      return;
    }
    setPhase('idle');
    await finishCover();
  };

  async function startRecording() {
    if (phaseRef.current !== 'idle' || !videoOutputRef.current) {
      return;
    }
    if (!canRecord) {
      setMessage('Pick a cover preset first (picture, black, text, or lock screen).');
      return;
    }
    if (!cameraReady || !device) {
      setMessage('The camera is still starting. Wait a second and try again.');
      return;
    }
    if (settings.mic && !microphonePermission.hasPermission) {
      if (microphonePermission.canRequestPermission) {
        const granted = await microphonePermission.requestPermission();
        if (!granted) {
          setSettings((current) => ({ ...current, mic: false }));
          setMessage('Microphone was denied, so this take will record video only.');
        }
      } else {
        setSettings((current) => ({ ...current, mic: false }));
        setMessage('Microphone is off in Settings, so this take will record video only.');
      }
    }

    cancelRef.current = false;
    handledRef.current = false;
    clearStopWatch();
    setMessage(null);
    setUnsavedPath(null);
    setLockSurface('lock');
    lastLitSurfaceRef.current = 'lock';
    setPhase('starting');

    try {
      await activateKeepAwakeAsync();
      previousBrightnessRef.current = await Brightness.getBrightnessAsync();
      await Brightness.setBrightnessAsync(BRIGHTNESS_VALUE[settings.brightness]);
      await armVolumeButtons();
      if (cancelRef.current) {
        setPhase('idle');
        await finishCover();
        return;
      }
      const output = videoOutputRef.current;
      if (!output) {
        throw new Error('Camera is not ready.');
      }
      const recorder = await output.createRecorder({});
      if (cancelRef.current) {
        setPhase('idle');
        await finishCover();
        return;
      }
      recorderRef.current = recorder;
      await recorder.startRecording(
        (path) => {
          recorderRef.current = null;
          void storeFinishedVideo(path);
        },
        (error) => {
          if (handledRef.current) {
            return;
          }
          handledRef.current = true;
          clearStopWatch();
          recorderRef.current = null;
          setPhase('idle');
          setMessage(errorText(error));
          void finishCover();
        },
      );
      if (cancelRef.current) {
        if (recorder.isRecording) {
          await recorder.stopRecording();
        } else {
          setPhase('idle');
          await finishCover();
        }
        return;
      }
      setPhase('recording');
      if (settings.coverPreset === 'lock') {
        setMessage(null);
      }
    } catch (error) {
      recorderRef.current = null;
      setPhase('idle');
      setMessage(
        `${errorText(error)} Volume buttons only work in the installed app, not in Expo Go.`,
      );
      await finishCover();
    }
  }

  async function chooseCover() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) {
      return;
    }
    try {
      const coverUri = await persistCoverImage(result.assets[0].uri);
      setSettings((current) => ({ ...current, coverUri, coverPreset: 'image' }));
      setMessage('Picture saved for the Image cover preset.');
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function chooseLockWallpaper() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.95,
    });
    if (result.canceled || !result.assets[0]) {
      return;
    }
    try {
      const lockWallpaperUri = await persistLockWallpaper(result.assets[0].uri);
      setSettings((current) => ({ ...current, lockWallpaperUri, coverPreset: 'lock' }));
      setMessage('Lock wallpaper saved. Tip: take a screenshot of your real Lock Screen and pick that.');
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function chooseHomeShot() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.95,
    });
    if (result.canceled || !result.assets[0]) {
      return;
    }
    try {
      const homeShotUri = await persistHomeShot(result.assets[0].uri);
      setSettings((current) => ({ ...current, homeShotUri, coverPreset: 'lock' }));
      setMessage('Home Screen picture saved. Tip: screenshot your real Home Screen.');
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function retrySave() {
    if (!unsavedPath) {
      return;
    }
    setSaving(true);
    try {
      await saveVideoToPhotos(unsavedPath);
      setUnsavedPath(null);
      setMessage('Saved to Photos.');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  function setPreset(coverPreset: CoverPreset) {
    setSettings((current) => ({ ...current, coverPreset }));
  }

  function openNewTextEditor() {
    const draft = newTextPreset(`Text ${settings.textPresets.length + 1}`);
    setEditorDraft(draft);
    setEditorOpen(true);
  }

  function openEditTextEditor() {
    if (!activeText) {
      openNewTextEditor();
      return;
    }
    setEditorDraft(activeText);
    setEditorOpen(true);
  }

  function saveTextPreset(preset: TextPreset) {
    setSettings((current) => {
      const exists = current.textPresets.some((item) => item.id === preset.id);
      return {
        ...current,
        coverPreset: 'text',
        activeTextPresetId: preset.id,
        textPresets: exists
          ? current.textPresets.map((item) => (item.id === preset.id ? preset : item))
          : [...current.textPresets, preset],
      };
    });
    setEditorOpen(false);
    setEditorDraft(null);
    setMessage('Text cover saved.');
  }

  if (!cameraPermission.hasPermission) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <StatusBar style="light" />
        <Text style={styles.title}>Stage Cover</Text>
        <Text style={styles.body}>
          Records the play under a cover screen so people behind you are not staring at a bright
          camera app.
        </Text>
        <Pressable
          style={styles.recordButton}
          onPress={() => {
            if (cameraPermission.canRequestPermission) {
              void cameraPermission.requestPermission();
            } else {
              void Linking.openSettings();
            }
          }}
        >
          <Text style={styles.recordLabel}>
            {cameraPermission.canRequestPermission ? 'Allow the camera' : 'Open Settings'}
          </Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar hidden={covering} style="light" />
      {device && previewVisible ? (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={cameraPermission.hasPermission && (appActive || phase !== 'idle')}
          outputs={[videoOutput]}
          constraints={constraints}
          torchMode={torchOn ? 'on' : 'off'}
          zoom={zoom}
          enableLowLightBoost={device.supportsLowLightBoost ? settings.lowLight : undefined}
          resizeMode="cover"
          onStarted={() => setCameraReady(true)}
          onStopped={() => setCameraReady(false)}
          onSessionConfigSelected={(config) => {
            setActiveFps(config.selectedFPS ?? null);
          }}
          onError={(error) => {
            if (phaseRef.current === 'idle') {
              setMessage(errorText(error));
            }
          }}
        />
      ) : (
        <View style={styles.previewOff}>
          <Text style={styles.previewOffLabel}>Camera preview hidden</Text>
        </View>
      )}

      {!covering ? (
        <SafeAreaView style={styles.idleChrome} pointerEvents="box-none">
          <Pressable
            style={styles.eyeHit}
            onPress={() =>
              setSettings((current) => ({ ...current, showPreview: !current.showPreview }))
            }
          >
            <Text style={styles.eyeIcon}>{settings.showPreview ? '👁' : '🙈'}</Text>
            <Text style={styles.eyeLabel}>{settings.showPreview ? 'Hide preview' : 'Show preview'}</Text>
          </Pressable>
        </SafeAreaView>
      ) : null}

      {covering ? (
        <View
          style={styles.cover}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
        >
          {settings.coverPreset === 'black' ? <View style={styles.blackCover} /> : null}

          {settings.coverPreset === 'image' && settings.coverUri ? (
            <Image
              source={{ uri: settings.coverUri }}
              style={styles.coverImage}
              resizeMode={settings.fit === 'fill' ? 'cover' : 'contain'}
            />
          ) : null}

          {settings.coverPreset === 'text' && activeText ? (
            <View style={[styles.blackCover, { backgroundColor: activeText.background }]}>
              {activeText.layers.map((layer) => (
                <Text
                  key={layer.id}
                  style={{
                    position: 'absolute',
                    left: layer.x * Dimensions.get('window').width - 90,
                    top: layer.y * Dimensions.get('window').height - 20,
                    width: 180,
                    textAlign: 'center',
                    color: layer.color,
                    fontSize: layer.size,
                    fontWeight: '700',
                  }}
                >
                  {layer.text}
                </Text>
              ))}
            </View>
          ) : null}

          {settings.coverPreset === 'lock' ? (
            <LockScreenCover
              surface={lockSurface}
              wallpaperUri={settings.lockWallpaperUri}
              homeShotUri={settings.homeShotUri}
              pin={settings.lockPin}
              onSwipeToPasscode={() => {
                lastLitSurfaceRef.current = 'passcode';
                setLockSurface('passcode');
              }}
              onUnlock={() => {
                lastLitSurfaceRef.current = 'home';
                setLockSurface('home');
              }}
              onBackToLock={() => {
                lastLitSurfaceRef.current = 'lock';
                setLockSurface('lock');
              }}
            />
          ) : null}

        </View>
      ) : (
        <SafeAreaView style={styles.controlsLayer} pointerEvents="box-none">
          <View style={styles.previewSpacer} pointerEvents="none" />
          <ScrollView
            style={styles.panel}
            contentContainerStyle={styles.panelContent}
            bounces={false}
          >
            <Text style={styles.title}>Stage Cover</Text>
            <Text style={styles.body}>
              Preview fills most of the screen. Tap the eye at the top to hide it. Press Record and
              the cover takes over. Volume down stops. In Lock Screen mode, volume up acts like the
              power button.
            </Text>
            {activeFps != null ? (
              <Text style={styles.note}>Camera negotiated {activeFps} fps for this setup.</Text>
            ) : null}

            <Text style={styles.label}>Cover preset</Text>
            <OptionRow<CoverPreset>
              options={[
                { id: 'image', label: 'Image' },
                { id: 'black', label: 'Black' },
                { id: 'text', label: 'Text' },
                { id: 'lock', label: 'Lock' },
              ]}
              selected={settings.coverPreset}
              onSelect={setPreset}
            />

            {settings.coverPreset === 'image' ? (
              <>
                <Pressable style={styles.secondaryButton} onPress={() => void chooseCover()}>
                  {settings.coverUri ? (
                    <Image source={{ uri: settings.coverUri }} style={styles.thumb} />
                  ) : null}
                  <Text style={styles.secondaryLabel}>
                    {settings.coverUri ? 'Change picture' : 'Choose picture'}
                  </Text>
                </Pressable>
                <OptionRow<FitId>
                  options={[
                    { id: 'fill', label: 'Fill screen' },
                    { id: 'fit', label: 'Show all' },
                  ]}
                  selected={settings.fit}
                  onSelect={(fit) => setSettings((current) => ({ ...current, fit }))}
                />
              </>
            ) : null}

            {settings.coverPreset === 'black' ? (
              <Text style={styles.note}>Full black screen while the camera keeps recording.</Text>
            ) : null}

            {settings.coverPreset === 'text' ? (
              <>
                <Pressable style={styles.secondaryButton} onPress={openEditTextEditor}>
                  <Text style={styles.secondaryLabel}>
                    {activeText ? `Edit “${activeText.name}”` : 'Make text cover'}
                  </Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={openNewTextEditor}>
                  <Text style={styles.secondaryLabel}>New text cover</Text>
                </Pressable>
                {settings.textPresets.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
                    {settings.textPresets.map((preset) => (
                      <Pressable
                        key={preset.id}
                        style={[
                          styles.presetChip,
                          preset.id === settings.activeTextPresetId && styles.presetChipOn,
                        ]}
                        onPress={() =>
                          setSettings((current) => ({
                            ...current,
                            activeTextPresetId: preset.id,
                            coverPreset: 'text',
                          }))
                        }
                      >
                        <Text
                          style={[
                            styles.presetChipLabel,
                            preset.id === settings.activeTextPresetId && styles.chipLabelActive,
                          ]}
                        >
                          {preset.name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}
              </>
            ) : null}

            {settings.coverPreset === 'lock' ? (
              <>
                <Text style={styles.note}>
                  iOS will not hand over your real Lock Screen. Use screenshots of your Lock Screen
                  and Home Screen so it looks like yours. Set the fake passcode to the same digits
                  you use if you want it to feel real. While recording: volume up = screen off/on,
                  volume down = stop.
                </Text>
                <Pressable style={styles.secondaryButton} onPress={() => void chooseLockWallpaper()}>
                  {settings.lockWallpaperUri ? (
                    <Image source={{ uri: settings.lockWallpaperUri }} style={styles.thumb} />
                  ) : null}
                  <Text style={styles.secondaryLabel}>
                    {settings.lockWallpaperUri ? 'Change lock picture' : 'Lock Screen picture'}
                  </Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => void chooseHomeShot()}>
                  {settings.homeShotUri ? (
                    <Image source={{ uri: settings.homeShotUri }} style={styles.thumb} />
                  ) : null}
                  <Text style={styles.secondaryLabel}>
                    {settings.homeShotUri ? 'Change home picture' : 'Home Screen picture'}
                  </Text>
                </Pressable>
                <Text style={styles.label}>Fake unlock passcode</Text>
                <TextInput
                  style={styles.pinInput}
                  value={settings.lockPin}
                  onChangeText={(lockPin) =>
                    setSettings((current) => ({
                      ...current,
                      lockPin: lockPin.replace(/[^0-9]/g, '').slice(0, 6),
                    }))
                  }
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={6}
                  placeholder="000000"
                  placeholderTextColor="#71717a"
                />
              </>
            ) : null}

            <Text style={styles.label}>Resolution</Text>
            <OptionRow<ResolutionId>
              options={[
                { id: '720', label: '720p' },
                { id: '1080', label: '1080p' },
                { id: '4k', label: '4K' },
              ]}
              selected={settings.resolution}
              onSelect={(resolution) => setSettings((current) => ({ ...current, resolution }))}
            />

            <Text style={styles.label}>Frame rate</Text>
            <OptionRow<string>
              options={FPS_OPTIONS.map((fps) => ({ id: String(fps), label: `${fps} fps` }))}
              selected={String(settings.fps)}
              onSelect={(fps) =>
                setSettings((current) => ({ ...current, fps: Number(fps) as FpsId }))
              }
            />

            <Text style={styles.label}>Camera</Text>
            <OptionRow<LensId>
              options={[
                { id: 'ultra', label: '0.5 wide' },
                { id: 'wide', label: '1x' },
                { id: 'front', label: 'Selfie' },
              ]}
              selected={settings.lens}
              onSelect={(lens) => setSettings((current) => ({ ...current, lens }))}
            />

            <Text style={styles.label}>Flash</Text>
            <OptionRow
              options={[
                { id: 'off', label: 'Off' },
                { id: 'on', label: 'On' },
              ]}
              selected={settings.flash ? 'on' : 'off'}
              onSelect={(value) =>
                setSettings((current) => ({ ...current, flash: value === 'on' }))
              }
            />

            <Text style={styles.label}>Sound</Text>
            <OptionRow
              options={[
                { id: 'on', label: 'On' },
                { id: 'off', label: 'Off' },
              ]}
              selected={settings.mic ? 'on' : 'off'}
              onSelect={(value) => setSettings((current) => ({ ...current, mic: value === 'on' }))}
            />

            <Text style={styles.label}>Dark stage</Text>
            <OptionRow
              options={[
                { id: 'on', label: 'Brighten' },
                { id: 'off', label: 'Normal' },
              ]}
              selected={settings.lowLight ? 'on' : 'off'}
              onSelect={(value) =>
                setSettings((current) => ({ ...current, lowLight: value === 'on' }))
              }
            />

            <Text style={styles.label}>Cover brightness</Text>
            <OptionRow<BrightnessId>
              options={[
                { id: 'dim', label: 'Dim' },
                { id: 'medium', label: 'Medium' },
                { id: 'bright', label: 'Bright' },
              ]}
              selected={settings.brightness}
              onSelect={(brightness) => setSettings((current) => ({ ...current, brightness }))}
            />

            <Pressable
              style={[styles.recordButton, !canRecord && styles.recordDisabled]}
              disabled={!canRecord || !cameraReady}
              onPress={() => void startRecording()}
            >
              <Text style={styles.recordLabel}>
                {!canRecord ? 'Set up a cover first' : cameraReady ? 'Record' : 'Camera starting'}
              </Text>
            </Pressable>

            {message ? <Text style={styles.message}>{message}</Text> : null}
            {saving ? <ActivityIndicator color="#ffffff" /> : null}
            {unsavedPath ? (
              <Pressable style={styles.secondaryButton} onPress={() => void retrySave()}>
                <Text style={styles.secondaryLabel}>Save to Photos</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      )}

      {editorDraft ? (
        <TextPresetEditor
          visible={editorOpen}
          initial={editorDraft}
          onCancel={() => {
            setEditorOpen(false);
            setEditorDraft(null);
          }}
          onSave={saveTextPreset}
        />
      ) : null}
    </View>
  );
}

function OptionRow<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { id: T; label: string }[];
  selected: T;
  onSelect: (id: T) => void;
}) {
  return (
    <View style={styles.row}>
      {options.map((option) => {
        const active = option.id === selected;
        return (
          <Pressable
            key={option.id}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onSelect(option.id)}
          >
            <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  permissionScreen: {
    flex: 1,
    backgroundColor: '#111111',
    padding: 24,
    justifyContent: 'center',
    gap: 16,
  },
  idleChrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
  },
  eyeHit: {
    alignSelf: 'flex-end',
    marginTop: 8,
    marginRight: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  eyeIcon: {
    fontSize: 16,
  },
  eyeLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  previewOff: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#09090b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewOffLabel: {
    color: '#71717a',
    fontSize: 16,
  },
  controlsLayer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  previewSpacer: {
    flex: 1,
  },
  panel: {
    maxHeight: '46%',
    backgroundColor: 'rgba(12,12,14,0.94)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  panelContent: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 28,
    gap: 8,
  },
  title: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700',
  },
  body: {
    color: '#d4d4d8',
    fontSize: 15,
    lineHeight: 21,
  },
  label: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 8,
  },
  note: {
    color: '#a1a1aa',
    fontSize: 13,
    lineHeight: 18,
  },
  message: {
    color: '#ffffff',
    backgroundColor: '#27272a',
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    lineHeight: 20,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a2a2e',
    paddingHorizontal: 6,
  },
  chipActive: {
    backgroundColor: '#f4f4f5',
  },
  chipLabel: {
    color: '#f4f4f5',
    fontSize: 14,
    fontWeight: '600',
  },
  chipLabelActive: {
    color: '#111111',
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#2a2a2e',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 12,
  },
  secondaryLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  thumb: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#000000',
  },
  recordButton: {
    minHeight: 72,
    borderRadius: 36,
    backgroundColor: '#e11d2e',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  recordDisabled: {
    backgroundColor: '#7f1d1d',
  },
  recordLabel: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  cover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
  },
  coverImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },
  blackCover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
  },
  pinInput: {
    borderRadius: 12,
    backgroundColor: '#1c1c1e',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 20,
    letterSpacing: 6,
    textAlign: 'center',
  },
  presetRow: {
    maxHeight: 48,
  },
  presetChip: {
    marginRight: 8,
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2a2a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetChipOn: {
    backgroundColor: '#f4f4f5',
  },
  presetChipLabel: {
    color: '#fff',
    fontWeight: '600',
  },
});
