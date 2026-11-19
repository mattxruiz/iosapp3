import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
import {
  BRIGHTNESS_VALUE,
  type BrightnessId,
  DEFAULT_SETTINGS,
  type FitId,
  type FpsId,
  type LensId,
  loadSettings,
  persistCoverImage,
  type ResolutionId,
  RESOLUTION_SIZE,
  saveSettings,
  type Settings,
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

  const phaseRef = useRef<Phase>('idle');
  const recorderRef = useRef<Recorder | null>(null);
  const cancelRef = useRef(false);
  const releaseVolumeRef = useRef<(() => Promise<void>) | null>(null);
  const previousVolumeRef = useRef<number | null>(null);
  const previousBrightnessRef = useRef<number | null>(null);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const videoOutputRef = useRef<ReturnType<typeof useVideoOutput> | null>(null);
  const handledRef = useRef(false);
  const stopWatchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }

  async function armVolumeStop() {
    const current = await VolumeManager.getVolume();
    previousVolumeRef.current = current.volume;
    let armed = false;
    const subscription = VolumeManager.addVolumeListener(() => {
      if (!armed) {
        return;
      }
      armed = false;
      void stopRef.current();
    });
    await VolumeManager.showNativeVolumeUI({ enabled: false });
    if (Math.abs(current.volume - 0.5) > 0.02) {
      await VolumeManager.setVolume(0.5, { showUI: false, playSound: false });
    }
    const armTimer = setTimeout(() => {
      armed = true;
    }, 400);
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
    if (!settings.coverUri) {
      setMessage('Choose the picture people behind you will see.');
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
    setPhase('starting');

    try {
      await activateKeepAwakeAsync();
      previousBrightnessRef.current = await Brightness.getBrightnessAsync();
      await Brightness.setBrightnessAsync(BRIGHTNESS_VALUE[settings.brightness]);
      await armVolumeStop();
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
      setSettings((current) => ({ ...current, coverUri }));
      setMessage('Picture saved. That is what the screen will show while recording.');
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

  if (!cameraPermission.hasPermission) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <StatusBar style="light" />
        <Text style={styles.title}>Stage Cover</Text>
        <Text style={styles.body}>
          This records the play with the camera, then covers the whole screen with your picture so
          the people behind you are not looking at a bright camera app.
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
      {device ? (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={cameraPermission.hasPermission && (appActive || phase !== 'idle')}
          outputs={[videoOutput]}
          constraints={constraints}
          torchMode={torchOn ? 'on' : 'off'}
          zoom={zoom}
          enableLowLightBoost={
            device.supportsLowLightBoost ? settings.lowLight : undefined
          }
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
        <View style={styles.missingCamera}>
          <Text style={styles.body}>This iPhone does not have that camera.</Text>
        </View>
      )}

      {covering && settings.coverUri ? (
        <View
          style={styles.cover}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
        >
          <Image
            source={{ uri: settings.coverUri }}
            style={styles.coverImage}
            resizeMode={settings.fit === 'fill' ? 'cover' : 'contain'}
          />
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
              Frame the stage in the picture above. Press record and the screen becomes your
              picture. Press volume up or volume down to stop. Taps do nothing while it is
              recording.
            </Text>
            {activeFps != null ? (
              <Text style={styles.note}>
                The phone is set to record at {activeFps} fps. An iPhone 14 does 4K at 30 fps, and
                60 fps at 1080p or 720p.
              </Text>
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
            <Text style={styles.note}>
              Look at the preview. 0.5 should show more of the stage than 1x. Selfie uses the
              screen side of the phone.
            </Text>

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
            {settings.flash ? (
              <Text style={styles.warning}>
                Flash lights the stage. Leave it off during the play.
              </Text>
            ) : null}

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

            <Text style={styles.label}>Picture on the screen</Text>
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
            <Text style={styles.note}>
              Use a picture of your social @. If the handle gets cut off, choose Show all.
            </Text>

            <Text style={styles.label}>How bright that picture is</Text>
            <OptionRow<BrightnessId>
              options={[
                { id: 'dim', label: 'Dim' },
                { id: 'medium', label: 'Medium' },
                { id: 'bright', label: 'Bright' },
              ]}
              selected={settings.brightness}
              onSelect={(brightness) =>
                setSettings((current) => ({ ...current, brightness }))
              }
            />

            <Pressable
              style={[styles.recordButton, !settings.coverUri && styles.recordDisabled]}
              disabled={!settings.coverUri || !cameraReady}
              onPress={() => void startRecording()}
            >
              <Text style={styles.recordLabel}>
                {!settings.coverUri
                  ? 'Choose a picture first'
                  : cameraReady
                    ? 'Record'
                    : 'Camera starting'}
              </Text>
            </Pressable>
            <Text style={styles.note}>
              Do one short test at home. For a whole play, 1080p at 30 fps uses less space and
              stays cooler than 4K. Do not lock the phone, and do not swipe down from the corner.
            </Text>

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
  controlsLayer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  previewSpacer: {
    flex: 1,
  },
  panel: {
    maxHeight: '62%',
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
    fontSize: 16,
    lineHeight: 22,
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
  warning: {
    color: '#fbbf24',
    fontSize: 14,
    lineHeight: 19,
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
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a2a2e',
    paddingHorizontal: 8,
  },
  chipActive: {
    backgroundColor: '#f4f4f5',
  },
  chipLabel: {
    color: '#f4f4f5',
    fontSize: 15,
    fontWeight: '600',
  },
  chipLabelActive: {
    color: '#111111',
  },
  secondaryButton: {
    minHeight: 56,
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
    fontSize: 17,
    fontWeight: '600',
  },
  thumb: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#000000',
  },
  recordButton: {
    minHeight: 76,
    borderRadius: 38,
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
    fontSize: 22,
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
  missingCamera: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
