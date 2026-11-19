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
import AppLockGate from './components/AppLockGate';
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
    throw new Error('Photos access was denied. Allow saving to Photos, then tap Save to Photos.');
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
    return Boolean(
      settings.activeTextPresetId &&
        settings.textPresets.some((item) => item.id === settings.activeTextPresetId),
    );
  }
  return Boolean(
    settings.lockWallpaperUri && settings.homeShotUri && settings.lockPin.length >= 4,
  );
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
  const [appUnlocked, setAppUnlocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeFps, setActiveFps] = useState<number | null>(null);
  const [unsavedPath, setUnsavedPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDraft, setEditorDraft] = useState<TextPreset | null>(null);
  const [lockSurface, setLockSurface] = useState<LockSurface>('lock');

  const phaseRef = useRef<Phase>('idle');
  const settingsRef = useRef(settings);
  const canRecordRef = useRef(false);
  const cameraReadyRef = useRef(false);
  const lastLitSurfaceRef = useRef<Exclude<LockSurface, 'off'>>('lock');
  const recorderRef = useRef<Recorder | null>(null);
  const cancelRef = useRef(false);
  const releaseVolumeRef = useRef<(() => Promise<void>) | null>(null);
  const previousVolumeRef = useRef<number | null>(null);
  const previousBrightnessRef = useRef<number | null>(null);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const startRef = useRef<() => Promise<void>>(async () => {});
  const powerRef = useRef<() => void>(() => {});
  const videoOutputRef = useRef<ReturnType<typeof useVideoOutput> | null>(null);
  const handledRef = useRef(false);
  const stopWatchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  settingsRef.current = settings;
  cameraReadyRef.current = cameraReady;

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
  const recordAudio = settings.mic && microphonePermission.hasPermission;
  const videoOutput = useVideoOutput({
    targetResolution: RESOLUTION_SIZE[settings.resolution],
    enableAudio: recordAudio,
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
  canRecordRef.current = canRecord;

  const needsAppLock =
    settingsReady && settings.appLockEnabled && settings.appLockPin.length >= 4 && !appUnlocked;

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
      setAppUnlocked(!(stored.appLockEnabled && stored.appLockPin.length >= 4));
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
        if (settingsRef.current.appLockEnabled && settingsRef.current.appLockPin.length >= 4) {
          setAppUnlocked(false);
        }
      }
    });
    return () => subscription.remove();
  }, []);

  // Idle volume-down starts recording. Recording handler is armed separately.
  useEffect(() => {
    if (covering || needsAppLock || !settingsReady) {
      return;
    }
    let armed = false;
    let lastVolume = 0.5;
    let release: (() => Promise<void>) | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const current = await VolumeManager.getVolume();
        if (cancelled) {
          return;
        }
        lastVolume = current.volume;
        await VolumeManager.showNativeVolumeUI({ enabled: false });
        const listener = VolumeManager.addVolumeListener((result) => {
          if (!armed) {
            lastVolume = result.volume;
            return;
          }
          const goingDown =
            result.volume < lastVolume - 0.001 || (lastVolume <= 0.02 && result.volume <= 0.02);
          lastVolume = result.volume;
          if (goingDown && phaseRef.current === 'idle') {
            void startRef.current();
          }
        });
        const timer = setTimeout(() => {
          armed = true;
        }, 400);
        release = async () => {
          clearTimeout(timer);
          armed = false;
          listener.remove();
          await VolumeManager.showNativeVolumeUI({ enabled: true }).catch(() => {});
        };
      } catch {
        // Volume hooks only work in the installed app.
      }
    })();

    return () => {
      cancelled = true;
      void release?.();
    };
  }, [covering, needsAppLock, settingsReady]);

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

  async function armRecordingVolumeButtons() {
    const current = await VolumeManager.getVolume();
    previousVolumeRef.current = current.volume;
    let armed = false;
    let lastVolume = 0.5;
    const subscription = VolumeManager.addVolumeListener((result) => {
      if (!armed) {
        lastVolume = result.volume;
        return;
      }
      const goingUp =
        result.volume > lastVolume + 0.001 || (lastVolume >= 0.98 && result.volume >= 0.98);
      const goingDown =
        result.volume < lastVolume - 0.001 || (lastVolume <= 0.02 && result.volume <= 0.02);
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
      setMessage('Saved to Photos.');
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
          setMessage('Recording stopped.');
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

  startRef.current = async () => {
    if (phaseRef.current !== 'idle' || !videoOutputRef.current) {
      return;
    }
    if (!canRecordRef.current) {
      setMessage(
        settingsRef.current.coverPreset === 'lock'
          ? 'Lock mode needs lock picture, home picture, and a passcode.'
          : 'Set up a cover preset first.',
      );
      return;
    }
    if (!cameraReadyRef.current || !device) {
      setMessage('Camera still starting — wait a second.');
      return;
    }

    // Silent recording when Sound is Off — never ask for mic.
    if (settingsRef.current.mic && !microphonePermission.hasPermission) {
      if (microphonePermission.canRequestPermission) {
        const granted = await microphonePermission.requestPermission();
        if (!granted) {
          setSettings((current) => ({ ...current, mic: false }));
          setMessage('Mic denied. Sound turned Off — tap Rec again for a silent video.');
          return;
        }
      } else {
        setSettings((current) => ({ ...current, mic: false }));
        setMessage('Mic unavailable. Sound turned Off — tap Rec again for a silent video.');
        return;
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
      await Brightness.setBrightnessAsync(BRIGHTNESS_VALUE[settingsRef.current.brightness]);
      await armRecordingVolumeButtons();
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
          const text = errorText(error);
          if (/audio|microphone|mic/i.test(text)) {
            setSettings((current) => ({ ...current, mic: false }));
            setMessage('Audio blocked. Sound is now Off — tap Rec for a silent video.');
          } else {
            setMessage(text);
          }
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
    } catch (error) {
      recorderRef.current = null;
      setPhase('idle');
      const text = errorText(error);
      if (/audio|microphone|mic/i.test(text)) {
        setSettings((current) => ({ ...current, mic: false }));
        setMessage('Audio blocked. Sound is now Off — tap Rec for a silent video.');
      } else {
        setMessage(text);
      }
      await finishCover();
    }
  };

  async function chooseCover() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) {
      return;
    }
    const coverUri = await persistCoverImage(result.assets[0].uri);
    setSettings((current) => ({ ...current, coverUri, coverPreset: 'image' }));
  }

  async function chooseLockWallpaper() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.95,
    });
    if (result.canceled || !result.assets[0]) {
      return;
    }
    const lockWallpaperUri = await persistLockWallpaper(result.assets[0].uri);
    setSettings((current) => ({ ...current, lockWallpaperUri, coverPreset: 'lock' }));
  }

  async function chooseHomeShot() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.95,
    });
    if (result.canceled || !result.assets[0]) {
      return;
    }
    const homeShotUri = await persistHomeShot(result.assets[0].uri);
    setSettings((current) => ({ ...current, homeShotUri, coverPreset: 'lock' }));
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

  async function enableSound(on: boolean) {
    if (!on) {
      setSettings((current) => ({ ...current, mic: false }));
      return;
    }
    if (!microphonePermission.hasPermission) {
      if (!microphonePermission.canRequestPermission) {
        setMessage('Mic permission is blocked in iPhone Settings.');
        setSettings((current) => ({ ...current, mic: false }));
        return;
      }
      const granted = await microphonePermission.requestPermission();
      if (!granted) {
        setMessage('Mic denied — videos will stay silent.');
        setSettings((current) => ({ ...current, mic: false }));
        return;
      }
    }
    setSettings((current) => ({ ...current, mic: true }));
  }

  if (!cameraPermission.hasPermission) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <StatusBar style="light" />
        <Text style={styles.body}>Allow the camera so the play can be recorded under a cover screen.</Text>
        <Pressable
          style={styles.quietButton}
          onPress={() => {
            if (cameraPermission.canRequestPermission) {
              void cameraPermission.requestPermission();
            } else {
              void Linking.openSettings();
            }
          }}
        >
          <Text style={styles.quietButtonLabel}>
            {cameraPermission.canRequestPermission ? 'Allow camera' : 'Open Settings'}
          </Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar hidden={covering || needsAppLock} style="light" />

      {device ? (
        <Camera
          style={[StyleSheet.absoluteFill, !settings.showPreview && !covering ? styles.cameraHidden : null]}
          device={device}
          isActive={cameraPermission.hasPermission && (appActive || covering)}
          outputs={[videoOutput]}
          constraints={constraints}
          torchMode={torchOn ? 'on' : 'off'}
          zoom={zoom}
          enableLowLightBoost={device.supportsLowLightBoost ? settings.lowLight : undefined}
          resizeMode="cover"
          onStarted={() => setCameraReady(true)}
          onStopped={() => setCameraReady(false)}
          onSessionConfigSelected={(config) => setActiveFps(config.selectedFPS ?? null)}
          onError={(error) => {
            if (phaseRef.current === 'idle') {
              setMessage(errorText(error));
            }
          }}
        />
      ) : null}

      {!settings.showPreview && !covering ? <View style={styles.previewMask} /> : null}

      {covering ? (
        <View style={styles.cover} pointerEvents="auto">
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
        <SafeAreaView style={styles.idleLayer} pointerEvents="box-none">
          <View style={styles.topBar} pointerEvents="box-none">
            <Pressable
              style={[styles.recChip, (!canRecord || !cameraReady) && styles.recChipDisabled]}
              disabled={!canRecord || !cameraReady}
              onPress={() => void startRef.current()}
            >
              <View style={styles.recDot} />
              <Text style={styles.recChipLabel}>{cameraReady ? 'Rec' : '…'}</Text>
            </Pressable>
            <Pressable
              style={styles.eyeHit}
              onPress={() =>
                setSettings((current) => ({ ...current, showPreview: !current.showPreview }))
              }
            >
              <Text style={styles.eyeLabel}>{settings.showPreview ? 'Hide' : 'Show'}</Text>
            </Pressable>
          </View>

          <View style={styles.previewSpacer} pointerEvents="none" />

          <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent} bounces={false}>
            <Text style={styles.note}>
              Volume down starts recording. While recording, volume down stops
              {settings.coverPreset === 'lock' ? '; volume up is power' : ''}.
            </Text>
            {activeFps != null ? <Text style={styles.note}>{activeFps} fps</Text> : null}

            <Text style={styles.label}>Cover</Text>
            <OptionRow<CoverPreset>
              options={[
                { id: 'image', label: 'Image' },
                { id: 'black', label: 'Black' },
                { id: 'text', label: 'Text' },
                { id: 'lock', label: 'Lock' },
              ]}
              selected={settings.coverPreset}
              onSelect={(coverPreset) => setSettings((current) => ({ ...current, coverPreset }))}
            />

            {settings.coverPreset === 'image' ? (
              <>
                <Pressable style={styles.secondaryButton} onPress={() => void chooseCover()}>
                  {settings.coverUri ? <Image source={{ uri: settings.coverUri }} style={styles.thumb} /> : null}
                  <Text style={styles.secondaryLabel}>
                    {settings.coverUri ? 'Change picture' : 'Choose picture'}
                  </Text>
                </Pressable>
                <OptionRow<FitId>
                  options={[
                    { id: 'fill', label: 'Fill' },
                    { id: 'fit', label: 'Fit' },
                  ]}
                  selected={settings.fit}
                  onSelect={(fit) => setSettings((current) => ({ ...current, fit }))}
                />
              </>
            ) : null}

            {settings.coverPreset === 'text' ? (
              <>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    const draft = activeText ?? newTextPreset(`Text ${settings.textPresets.length + 1}`);
                    setEditorDraft(draft);
                    setEditorOpen(true);
                  }}
                >
                  <Text style={styles.secondaryLabel}>{activeText ? 'Edit text' : 'Make text'}</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    const draft = newTextPreset(`Text ${settings.textPresets.length + 1}`);
                    setEditorDraft(draft);
                    setEditorOpen(true);
                  }}
                >
                  <Text style={styles.secondaryLabel}>New text</Text>
                </Pressable>
              </>
            ) : null}

            {settings.coverPreset === 'lock' ? (
              <>
                <Text style={styles.note}>
                  Required: lock picture, home picture, and passcode. Swipe sideways (or up) on the
                  lock picture to open passcode, like iPhone.
                </Text>
                <Pressable style={styles.secondaryButton} onPress={() => void chooseLockWallpaper()}>
                  {settings.lockWallpaperUri ? (
                    <Image source={{ uri: settings.lockWallpaperUri }} style={styles.thumb} />
                  ) : null}
                  <Text style={styles.secondaryLabel}>
                    {settings.lockWallpaperUri ? 'Change lock picture' : 'Lock picture (required)'}
                  </Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => void chooseHomeShot()}>
                  {settings.homeShotUri ? (
                    <Image source={{ uri: settings.homeShotUri }} style={styles.thumb} />
                  ) : null}
                  <Text style={styles.secondaryLabel}>
                    {settings.homeShotUri ? 'Change home picture' : 'Home picture (required)'}
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
                  placeholder="4–6 digits"
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
              options={FPS_OPTIONS.map((fps) => ({ id: String(fps), label: `${fps}` }))}
              selected={String(settings.fps)}
              onSelect={(fps) =>
                setSettings((current) => ({ ...current, fps: Number(fps) as FpsId }))
              }
            />

            <Text style={styles.label}>Lens</Text>
            <OptionRow<LensId>
              options={[
                { id: 'ultra', label: '0.5' },
                { id: 'wide', label: '1x' },
                { id: 'front', label: 'Front' },
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
              onSelect={(value) => setSettings((current) => ({ ...current, flash: value === 'on' }))}
            />

            <Text style={styles.label}>Sound</Text>
            <OptionRow
              options={[
                { id: 'off', label: 'Off' },
                { id: 'on', label: 'On' },
              ]}
              selected={settings.mic ? 'on' : 'off'}
              onSelect={(value) => void enableSound(value === 'on')}
            />
            <Text style={styles.note}>
              Sound Off records a silent video and never asks for the microphone.
            </Text>

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
                { id: 'medium', label: 'Med' },
                { id: 'bright', label: 'Bright' },
              ]}
              selected={settings.brightness}
              onSelect={(brightness) => setSettings((current) => ({ ...current, brightness }))}
            />

            <Text style={styles.label}>App lock</Text>
            <OptionRow
              options={[
                { id: 'off', label: 'Off' },
                { id: 'on', label: 'On' },
              ]}
              selected={settings.appLockEnabled ? 'on' : 'off'}
              onSelect={(value) =>
                setSettings((current) => ({ ...current, appLockEnabled: value === 'on' }))
              }
            />
            {settings.appLockEnabled ? (
              <>
                <Text style={styles.note}>Required every time the app opens.</Text>
                <TextInput
                  style={styles.pinInput}
                  value={settings.appLockPin}
                  onChangeText={(appLockPin) =>
                    setSettings((current) => ({
                      ...current,
                      appLockPin: appLockPin.replace(/[^0-9]/g, '').slice(0, 6),
                    }))
                  }
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={6}
                  placeholder="App passcode"
                  placeholderTextColor="#71717a"
                />
              </>
            ) : null}

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

      {needsAppLock ? (
        <AppLockGate pin={settings.appLockPin} onUnlock={() => setAppUnlocked(true)} />
      ) : null}

      {editorDraft ? (
        <TextPresetEditor
          visible={editorOpen}
          initial={editorDraft}
          onCancel={() => {
            setEditorOpen(false);
            setEditorDraft(null);
          }}
          onSave={(preset) => {
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
          }}
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
    backgroundColor: '#000',
  },
  permissionScreen: {
    flex: 1,
    backgroundColor: '#111',
    padding: 24,
    justifyContent: 'center',
    gap: 16,
  },
  cameraHidden: {
    opacity: 0,
  },
  previewMask: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#09090b',
  },
  idleLayer: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 4,
  },
  recChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(28,28,30,0.72)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  recChipDisabled: {
    opacity: 0.45,
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#a1a1aa',
  },
  recChipLabel: {
    color: '#e4e4e7',
    fontSize: 13,
    fontWeight: '600',
  },
  eyeHit: {
    backgroundColor: 'rgba(28,28,30,0.72)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  eyeLabel: {
    color: '#e4e4e7',
    fontSize: 13,
    fontWeight: '600',
  },
  previewSpacer: {
    flex: 1,
  },
  panel: {
    maxHeight: '48%',
    backgroundColor: 'rgba(12,12,14,0.96)',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  panelContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 30,
    gap: 8,
  },
  body: {
    color: '#d4d4d8',
    fontSize: 15,
    lineHeight: 21,
  },
  label: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
  },
  note: {
    color: '#a1a1aa',
    fontSize: 12,
    lineHeight: 17,
  },
  message: {
    color: '#fff',
    backgroundColor: '#27272a',
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a2a2e',
    paddingHorizontal: 4,
  },
  chipActive: {
    backgroundColor: '#e4e4e7',
  },
  chipLabel: {
    color: '#f4f4f5',
    fontSize: 13,
    fontWeight: '600',
  },
  chipLabelActive: {
    color: '#111',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#2a2a2e',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
  },
  secondaryLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  quietButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#2a2a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quietButtonLabel: {
    color: '#fff',
    fontWeight: '600',
  },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: 7,
    backgroundColor: '#000',
  },
  pinInput: {
    borderRadius: 10,
    backgroundColor: '#1c1c1e',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 18,
    letterSpacing: 4,
    textAlign: 'center',
  },
  cover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000',
    zIndex: 30,
  },
  coverImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  blackCover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000',
  },
});
