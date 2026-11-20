import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import Slider from '@react-native-community/slider';
import * as Battery from 'expo-battery';
import { createAssetAsync, requestPermissionsAsync } from 'expo-media-library/legacy';
import * as Brightness from 'expo-brightness';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
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
import NetInfo from '@react-native-community/netinfo';
import { useAuth } from './auth/AuthContext';
import AccountSidebar from './components/AccountSidebar';
import AppLockGate from './components/AppLockGate';
import LockScreenCover, { type LockSurface } from './components/LockScreenCover';
import RecUploadRing from './components/RecUploadRing';
import RecordingHud from './components/RecordingHud';
import RecordingsLibrary from './components/RecordingsLibrary';
import TextPresetEditor from './components/TextPresetEditor';
import { goToPhoneHome } from './goHome';
import { ingestRecording } from './recordings';
import {
  applyUserPreset,
  type CoverPreset,
  coverReady,
  DEFAULT_SETTINGS,
  deleteUserPreset,
  type FitId,
  formatBytes,
  type FpsId,
  imageCoverUris,
  type LensId,
  loadSettings,
  newTextPreset,
  type OrientationId,
  persistCoverImage,
  persistHomeShot,
  persistLockWallpaper,
  persistPlaylistImage,
  renameUserPreset,
  type ResolutionId,
  RESOLUTION_SIZE,
  saveSettings,
  saveUserPreset,
  type Settings,
  type TextPreset,
} from './settings';

type Phase = 'idle' | 'starting' | 'recording' | 'stopping';

const FPS_OPTIONS: FpsId[] = [24, 30, 60];
const LOW_STORAGE_BYTES = 2.5 * 1024 * 1024 * 1024;

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
  await createAssetAsync(uri);
}

async function saveMarksFile(marks: number[]): Promise<void> {
  if (marks.length === 0 || !FileSystem.documentDirectory) {
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const lines = marks.map((sec, index) => `#${index + 1}\t${sec}s`).join('\n');
  await FileSystem.writeAsStringAsync(
    `${FileSystem.documentDirectory}blacrec-marks-${stamp}.txt`,
    `BlacRec marks\n${lines}\n`,
  );
}

export default function BlacRec() {
  const cameraPermission = useCameraPermission();
  const microphonePermission = useMicrophonePermission();
  const wideDevice = useCameraDevice('back', {
    physicalDevices: ['ultra-wide-angle', 'wide-angle'],
  });
  const wideOnlyDevice = useCameraDevice('back', { physicalDevices: ['wide-angle'] });
  const ultraOnlyDevice = useCameraDevice('back', { physicalDevices: ['ultra-wide-angle'] });
  const frontDevice = useCameraDevice('front');
  const {
    user,
    quota,
    quotaLabel,
    recordConsumedSeconds,
    queueRecordingUpload,
    flushUploads,
    refreshQuota,
    driveRing,
  } = useAuth();

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [cameraReady, setCameraReady] = useState(false);
  const [appActive, setAppActive] = useState(true);
  const [appUnlocked, setAppUnlocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [unsavedPath, setUnsavedPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDraft, setEditorDraft] = useState<TextPreset | null>(null);
  const [lockSurface, setLockSurface] = useState<LockSurface>('lock');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [marks, setMarks] = useState<number[]>([]);
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [lowPower, setLowPower] = useState(false);
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [markFlash, setMarkFlash] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [hudVisible, setHudVisible] = useState(false);
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const [presetNameDraft, setPresetNameDraft] = useState('');
  const [renameDraft, setRenameDraft] = useState('');

  const phaseRef = useRef<Phase>('idle');
  const settingsRef = useRef(settings);
  const canRecordRef = useRef(false);
  const cameraReadyRef = useRef(false);
  const lastLitSurfaceRef = useRef<Exclude<LockSurface, 'off'>>('lock');
  const recorderRef = useRef<Recorder | null>(null);
  const cancelRef = useRef(false);
  const continueSplitRef = useRef(false);
  const releaseVolumeRef = useRef<(() => Promise<void>) | null>(null);
  const previousVolumeRef = useRef<number | null>(null);
  const previousBrightnessRef = useRef<number | null>(null);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const startRef = useRef<() => Promise<void>>(async () => {});
  const continueRef = useRef<() => Promise<void>>(async () => {});
  const powerRef = useRef<() => void>(() => {});
  const markRef = useRef<() => void>(() => {});
  const videoOutputRef = useRef<ReturnType<typeof useVideoOutput> | null>(null);
  const handledRef = useRef(false);
  const stopWatchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);
  const segmentStartedAtRef = useRef(0);
  const quotaLeftAtStartRef = useRef(0);
  const marksRef = useRef<number[]>([]);
  const lastStartTapRef = useRef(0);
  const recordConsumedSecondsRef = useRef(recordConsumedSeconds);
  const queueRecordingUploadRef = useRef(queueRecordingUpload);
  const quotaLeftRef = useRef(0);

  settingsRef.current = settings;
  cameraReadyRef.current = cameraReady;
  marksRef.current = marks;
  recordConsumedSecondsRef.current = recordConsumedSeconds;
  queueRecordingUploadRef.current = queueRecordingUpload;
  quotaLeftRef.current = quota?.secondsLeft ?? 0;

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
  const activeText =
    settings.textPresets.find((item) => item.id === settings.activeTextPresetId) ?? null;
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
    if (!settingsReady) {
      return;
    }
    const lock =
      settings.orientationLock === 'portrait'
        ? ScreenOrientation.OrientationLock.PORTRAIT_UP
        : settings.orientationLock === 'landscape'
          ? ScreenOrientation.OrientationLock.LANDSCAPE
          : ScreenOrientation.OrientationLock.DEFAULT;
    void ScreenOrientation.lockAsync(lock).catch(() => {});
  }, [settings.orientationLock, settingsReady]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      // Control Center / notification shade = "inactive". Keep recording.
      if (state === 'active') {
        setAppActive(true);
        void flushUploads();
        return;
      }
      if (state === 'inactive') {
        setAppActive(true);
        return;
      }
      // True background (home / other apps).
      if (settingsRef.current.usePhoneRegularly && phaseRef.current !== 'idle') {
        // Keep recording while they use the phone normally.
        setAppActive(true);
        return;
      }
      setAppActive(false);
      void stopRef.current();
      if (settingsRef.current.appLockEnabled && settingsRef.current.appLockPin.length >= 4) {
        setAppUnlocked(false);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const free = await FileSystem.getFreeDiskStorageAsync();
        const level = await Battery.getBatteryLevelAsync();
        const power = await Battery.isLowPowerModeEnabledAsync();
        if (!alive) {
          return;
        }
        setFreeBytes(free);
        setBatteryLevel(level);
        setLowPower(power);
      } catch {
        // Device APIs unavailable in some environments.
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 20000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'recording') {
      return;
    }
    const timer = setInterval(() => {
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000));
      setElapsedSec(elapsed);
      if (quotaLeftAtStartRef.current > 0 && elapsed >= quotaLeftAtStartRef.current) {
        void stopRef.current();
      }
    }, 500);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    void refreshQuota();
    const unsub = NetInfo.addEventListener((state) => {
      if (state.type === 'wifi' && state.isConnected) {
        void flushUploads();
      }
    });
    return () => unsub();
  }, [flushUploads, refreshQuota, user?.uid]);

  useEffect(() => {
    const uris = imageCoverUris(settings);
    if (!covering || settings.coverPreset !== 'image' || uris.length < 2) {
      return;
    }
    const timer = setInterval(() => {
      setPlaylistIndex((current) => (current + 1) % uris.length);
    }, Math.max(10, settings.playlistSeconds) * 1000);
    return () => clearInterval(timer);
  }, [covering, settings.coverPreset, settings.playlistSeconds, settings.playlistUris, settings.coverUri]);

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
        previousVolumeRef.current = current.volume;
        await VolumeManager.showNativeVolumeUI({ enabled: false });
        // Park mid-scale so every vol-down is detectable (floor/ceiling miss taps).
        await VolumeManager.setVolume(0.5, { showUI: false, playSound: false }).catch(() => {});
        lastVolume = 0.5;
        const listener = VolumeManager.addVolumeListener((result) => {
          if (!armed) {
            lastVolume = result.volume;
            return;
          }
          const delta = result.volume - lastVolume;
          const goingDown =
            delta < -0.008 ||
            (lastVolume <= 0.04 && result.volume <= lastVolume) ||
            (lastVolume <= 0.02 && result.volume <= 0.02);
          lastVolume = result.volume;
          if (!goingDown || phaseRef.current !== 'idle') {
            return;
          }
          const now = Date.now();
          if (now - lastStartTapRef.current < 900) {
            return;
          }
          lastStartTapRef.current = now;
          // Nudge volume back up so the next press still has room to drop.
          void VolumeManager.setVolume(0.55, { showUI: false, playSound: false }).catch(() => {});
          lastVolume = 0.55;
          void startRef.current();
        });
        const timer = setTimeout(() => {
          armed = true;
        }, 250);
        release = async () => {
          clearTimeout(timer);
          armed = false;
          listener.remove();
          if (previousVolumeRef.current != null && phaseRef.current === 'idle') {
            await VolumeManager.setVolume(previousVolumeRef.current, {
              showUI: false,
              playSound: false,
            }).catch(() => {});
            previousVolumeRef.current = null;
          }
          await VolumeManager.showNativeVolumeUI({ enabled: true }).catch(() => {});
        };
      } catch {
        // Installed app only.
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
    setElapsedSec(0);
  }

  powerRef.current = () => {
    if (settingsRef.current.coverPreset !== 'lock') {
      return;
    }
    setLockSurface((current) => {
      if (current === 'off') {
        // Wake like a real phone: always land on the fake lock picture.
        const restore = previousBrightnessRef.current;
        if (restore != null) {
          void Brightness.setBrightnessAsync(restore).catch(() => {});
        }
        lastLitSurfaceRef.current = 'lock';
        return 'lock';
      }
      lastLitSurfaceRef.current = current;
      void Brightness.setBrightnessAsync(0).catch(() => {});
      return 'off';
    });
  };

  markRef.current = () => {
    if (phaseRef.current !== 'recording') {
      return;
    }
    const sec = Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000));
    setMarks((current) => [...current, sec]);
    setMarkFlash(true);
    setTimeout(() => setMarkFlash(false), 500);
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
      if (goingUp) {
        if (lockMode) {
          // Volume up is only fake power in Lock mode. Marks use the tiny corner tap.
          powerRef.current();
          return;
        }
        markRef.current();
        return;
      }
      if (goingDown) {
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

  async function storeFinishedVideo(path: string, keepGoing: boolean) {
    const segmentSeconds = Math.max(
      1,
      Math.floor((Date.now() - segmentStartedAtRef.current) / 1000),
    );
    try {
      await recordConsumedSecondsRef.current(segmentSeconds);
    } catch {
      // Quota write can fail offline; still keep the take.
    }
    void queueRecordingUploadRef.current(path);

    let photosAssetId: string | null = null;
    let photosFailed = false;
    const autoSave = settingsRef.current.autoSaveToPhotos;
    if (autoSave) {
      try {
        const uri = path.startsWith('file://') ? path : `file://${path}`;
        const permission = await requestPermissionsAsync(true, ['video']);
        if (!permission.granted) {
          throw new Error('Photos access was denied.');
        }
        const asset = await createAssetAsync(uri);
        photosAssetId = asset.id;
      } catch (error) {
        photosFailed = true;
        if (!keepGoing) {
          setMessage(errorText(error));
        }
      }
    }

    try {
      await ingestRecording({
        sourcePath: path,
        durationSec: segmentSeconds,
        marks: keepGoing ? [] : marksRef.current,
        photosAssetId,
      });
      if (!keepGoing) {
        await saveMarksFile(marksRef.current);
        if (autoSave && !photosFailed) {
          setUnsavedPath(null);
          setMessage(
            marksRef.current.length > 0
              ? `In Recordings + Photos. ${marksRef.current.length} mark(s).`
              : 'In Recordings + Photos.',
          );
        } else {
          setUnsavedPath(path);
          if (!photosFailed) {
            setMessage('Saved in Recordings. Photos auto-save is off.');
          }
        }
      }
    } catch (error) {
      if (!keepGoing) {
        setUnsavedPath(path);
        setMessage(errorText(error));
      }
    }
    segmentStartedAtRef.current = Date.now();
  }

  async function beginRecorder(isContinuation: boolean) {
    const output = videoOutputRef.current;
    if (!output) {
      throw new Error('Camera is not ready.');
    }
    const split = settingsRef.current.splitMinutes;
    const recorder = await output.createRecorder({
      maxDuration: split > 0 ? split * 60 : undefined,
    });
    if (cancelRef.current && !isContinuation) {
      return;
    }
    recorderRef.current = recorder;
    handledRef.current = false;
    if (!isContinuation) {
      startedAtRef.current = Date.now();
      segmentStartedAtRef.current = startedAtRef.current;
      setElapsedSec(0);
      setMarks([]);
      marksRef.current = [];
    } else if (!segmentStartedAtRef.current) {
      segmentStartedAtRef.current = Date.now();
    }
    await recorder.startRecording(
      (path, reason) => {
        recorderRef.current = null;
        const splitContinue =
          reason === 'max-duration-reached' &&
          settingsRef.current.splitMinutes > 0 &&
          !cancelRef.current;
        continueSplitRef.current = splitContinue;
        void (async () => {
          await storeFinishedVideo(path, splitContinue);
          if (splitContinue) {
            setMessage(`Auto-split saved. Continuing…`);
            await continueRef.current();
            return;
          }
          handledRef.current = true;
          clearStopWatch();
          setSaving(false);
          setPhase('idle');
          await finishCover();
        })();
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
          setMessage('Audio blocked. Sound Off — tap Rec for silent video.');
        } else {
          setMessage(text);
        }
        void finishCover();
      },
    );
    if (cancelRef.current && !isContinuation) {
      if (recorder.isRecording) {
        await recorder.stopRecording();
      }
      return;
    }
    setPhase('recording');
  }

  continueRef.current = async () => {
    if (cancelRef.current) {
      setPhase('idle');
      await finishCover();
      return;
    }
    try {
      await beginRecorder(true);
    } catch (error) {
      setPhase('idle');
      setMessage(errorText(error));
      await finishCover();
    }
  };

  stopRef.current = async () => {
    const current = phaseRef.current;
    if (current === 'idle' || current === 'stopping') {
      return;
    }
    cancelRef.current = true;
    continueSplitRef.current = false;
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
        settingsRef.current.usePhoneRegularly
          ? 'Not ready to record yet.'
          : 'Set up a cover first.',
      );
      return;
    }
    if (!cameraReadyRef.current || !device) {
      setMessage('Camera still starting.');
      return;
    }

    // Use cached quota only — never await network before arming the take (vol-down lag).
    const left = quotaLeftRef.current;
    if (left <= 0) {
      setMessage('No recording time left. Resets 24h after your window started — check Account.');
      void refreshQuota();
      return;
    }
    quotaLeftAtStartRef.current = left;
    void refreshQuota();
    void FileSystem.getFreeDiskStorageAsync()
      .then((free) => {
        setFreeBytes(free);
        if (free < LOW_STORAGE_BYTES) {
          setMessage(
            `Low storage (${formatBytes(free)}). Use 1080p/30 or free space before a long take.`,
          );
        }
      })
      .catch(() => {});
    void Battery.getBatteryLevelAsync()
      .then((level) => {
        if (level >= 0) {
          setBatteryLevel(level);
        }
      })
      .catch(() => {});
    void Battery.isLowPowerModeEnabledAsync()
      .then((power) => setLowPower(power))
      .catch(() => {});

    if (settingsRef.current.mic && !microphonePermission.hasPermission) {
      if (microphonePermission.canRequestPermission) {
        const granted = await microphonePermission.requestPermission();
        if (!granted) {
          setSettings((current) => ({ ...current, mic: false }));
          setMessage('Mic denied. Sound Off — tap Rec again.');
          return;
        }
      } else {
        setSettings((current) => ({ ...current, mic: false }));
        setMessage('Mic blocked. Sound Off — tap Rec again.');
        return;
      }
    }

    cancelRef.current = false;
    continueSplitRef.current = false;
    handledRef.current = false;
    clearStopWatch();
    setUnsavedPath(null);
    setLockSurface('lock');
    lastLitSurfaceRef.current = 'lock';
    setPlaylistIndex(0);
    setHudVisible(false);
    setPhase('starting');

    try {
      await activateKeepAwakeAsync();
      previousBrightnessRef.current = await Brightness.getBrightnessAsync().catch(() => null);
      await armRecordingVolumeButtons();
      if (cancelRef.current) {
        setPhase('idle');
        await finishCover();
        return;
      }
      await beginRecorder(false);
      if (settingsRef.current.usePhoneRegularly && !cancelRef.current) {
        // Leave to the real home screen; recording continues in background mode.
        void goToPhoneHome();
      }
    } catch (error) {
      recorderRef.current = null;
      setPhase('idle');
      const text = errorText(error);
      if (/audio|microphone|mic/i.test(text)) {
        setSettings((current) => ({ ...current, mic: false }));
        setMessage('Audio blocked. Sound Off — tap Rec again.');
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
    setSettings((current) => ({
      ...current,
      coverUri,
      coverPreset: 'image',
      // First picture also seeds the rotate list when empty.
      playlistUris:
        current.playlistUris.length === 0 ? [coverUri] : current.playlistUris,
    }));
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

  async function addPlaylistImages() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      allowsMultipleSelection: true,
      selectionLimit: 8,
    });
    if (result.canceled || result.assets.length === 0) {
      return;
    }
    const saved: string[] = [];
    for (let index = 0; index < result.assets.length; index += 1) {
      saved.push(await persistPlaylistImage(result.assets[index].uri, index));
    }
    setSettings((current) => {
      const playlistUris = [...current.playlistUris, ...saved].slice(0, 12);
      return {
        ...current,
        playlistUris,
        coverUri: current.coverUri ?? playlistUris[0] ?? null,
        coverPreset: 'image',
      };
    });
  }

  async function enableSound(on: boolean) {
    if (!on) {
      setSettings((current) => ({ ...current, mic: false }));
      return;
    }
    if (!microphonePermission.hasPermission) {
      if (!microphonePermission.canRequestPermission) {
        setMessage('Mic blocked in iPhone Settings.');
        return;
      }
      const granted = await microphonePermission.requestPermission();
      if (!granted) {
        setMessage('Mic denied — staying silent.');
        return;
      }
    }
    setSettings((current) => ({ ...current, mic: true }));
  }

  function loadSelectedPreset(id: string) {
    const preset = settings.userPresets.find((item) => item.id === id);
    if (!preset) {
      return;
    }
    setSettings((current) => applyUserPreset(current, preset));
    setRenameDraft(preset.name);
    setMessage(`Loaded “${preset.name}”.`);
  }

  function saveCurrentAsPreset() {
    const name = presetNameDraft.trim() || renameDraft.trim();
    if (!name) {
      Alert.alert('Name needed', 'Type a preset name first.');
      return;
    }
    setSettings((current) => {
      const existed = current.userPresets.some(
        (p) => p.name.toLowerCase() === name.toLowerCase(),
      );
      const next = saveUserPreset(current, name);
      setMessage(existed ? `Overwrote preset “${name}”.` : `Saved preset “${name}”.`);
      return next;
    });
    setPresetNameDraft('');
    setRenameDraft(name);
  }

  if (!cameraPermission.hasPermission) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <StatusBar style="light" />
        <Text style={styles.body}>Allow the camera to record under a cover screen.</Text>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => {
            if (cameraPermission.canRequestPermission) {
              void cameraPermission.requestPermission();
            } else {
              void Linking.openSettings();
            }
          }}
        >
          <Text style={styles.secondaryLabel}>
            {cameraPermission.canRequestPermission ? 'Allow camera' : 'Open Settings'}
          </Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const coverImages = imageCoverUris(settings);
  const playlistUri = coverImages[playlistIndex] ?? coverImages[0] ?? null;

  return (
    <View style={styles.root}>
      <StatusBar hidden={covering || needsAppLock} style="light" />

      {device ? (
        <View
          style={
            covering || !settings.showPreview
              ? styles.hiddenCameraHost
              : styles.previewWindowAbsolute
          }
          pointerEvents="none"
        >
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={
              cameraPermission.hasPermission && (covering || appActive || phase !== 'idle')
            }
            outputs={[videoOutput]}
            constraints={constraints}
            torchMode={torchOn ? 'on' : 'off'}
            zoom={zoom}
            enableLowLightBoost={device.supportsLowLightBoost ? settings.lowLight : undefined}
            resizeMode="cover"
            onStarted={() => setCameraReady(true)}
            onStopped={() => setCameraReady(false)}
            onError={(error) => {
              if (phaseRef.current === 'idle') {
                setMessage(errorText(error));
              }
            }}
          />
        </View>
      ) : null}

      <AccountSidebar open={accountOpen} onClose={() => setAccountOpen(false)} />

      {!covering ? (
        <SafeAreaView style={styles.idleLayer} pointerEvents="box-none">
          <View style={styles.topBar}>
            <Pressable style={styles.accountHit} onPress={() => setAccountOpen(true)}>
              {user?.photoURL ? (
                <Image source={{ uri: user.photoURL }} style={styles.accountAvatar} />
              ) : (
                <View style={[styles.accountAvatar, styles.accountAvatarFallback]}>
                  <Text style={styles.accountAvatarLetter}>
                    {(user?.displayName ?? user?.email ?? 'A').slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
            </Pressable>
            <RecUploadRing
              status={driveRing.status}
              progress={driveRing.progress}
              disabled={!canRecord || !cameraReady}
              label={cameraReady ? 'Tap to Rec' : '…'}
              onPress={() => void startRef.current()}
            />
            <View style={styles.topBarSpacer} />
          </View>
          <Text style={styles.quotaBanner}>
            {quota?.unlimited
              ? 'Unlimited recording · tap avatar for account'
              : `${quotaLabel} left today · tap avatar for account`}
          </Text>

          <View style={styles.previewWindowSpacer}>
            {!settings.showPreview ? (
              <View style={styles.previewOff}>
                <Text style={styles.previewOffLabel}>Preview hidden</Text>
              </View>
            ) : (
              <View style={styles.previewWindowFrame} />
            )}
            <Pressable
              style={styles.previewEyeOverlay}
              onPress={() =>
                setSettings((current) => ({ ...current, showPreview: !current.showPreview }))
              }
            >
              <Text style={styles.eyeLabel}>{settings.showPreview ? 'Hide' : 'Show'}</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent} bounces={false}>
            {!settings.tipsDismissed ? (
              <View style={styles.tipBox}>
                <Text style={styles.tipTitle}>Before the show</Text>
                <Text style={styles.note}>
                  Opening Control Center should no longer stop the take — recording keeps going under
                  your cover. Guided Access (Settings → Accessibility) still helps block accidental
                  app switches during a long play.
                </Text>
                <Pressable
                  onPress={() => setSettings((current) => ({ ...current, tipsDismissed: true }))}
                >
                  <Text style={styles.tipDismiss}>Got it</Text>
                </Pressable>
              </View>
            ) : null}

            {(freeBytes != null && freeBytes < LOW_STORAGE_BYTES) ||
            (batteryLevel != null && batteryLevel < 0.2) ||
            lowPower ? (
              <Text style={styles.warn}>
                {freeBytes != null && freeBytes < LOW_STORAGE_BYTES
                  ? `Low storage: ${formatBytes(freeBytes)}. `
                  : ''}
                {batteryLevel != null && batteryLevel < 0.2
                  ? `Battery ${Math.round(batteryLevel * 100)}%. `
                  : ''}
                {lowPower ? 'Low Power Mode on. ' : ''}
                Prefer 1080p/30 and plug in.
              </Text>
            ) : null}

            <Text style={styles.label}>Presets</Text>
            {settings.userPresets.length === 0 ? (
              <Text style={styles.note}>No saved presets yet. Save your current setup below.</Text>
            ) : (
              <View style={styles.row}>
                {settings.userPresets.map((preset) => (
                  <Pressable
                    key={preset.id}
                    style={[
                      styles.presetChip,
                      settings.activeUserPresetId === preset.id && styles.presetChipOn,
                    ]}
                    onPress={() => loadSelectedPreset(preset.id)}
                    onLongPress={() => {
                      Alert.alert(preset.name, undefined, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () =>
                            setSettings((current) => deleteUserPreset(current, preset.id)),
                        },
                      ]);
                    }}
                  >
                    <Text
                      style={[
                        styles.presetChipLabel,
                        settings.activeUserPresetId === preset.id && styles.presetChipLabelOn,
                      ]}
                    >
                      {preset.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            <TextInput
              style={styles.pinInput}
              value={presetNameDraft}
              onChangeText={setPresetNameDraft}
              placeholder="New preset name"
              placeholderTextColor="#71717a"
            />
            <Pressable style={styles.secondaryButton} onPress={saveCurrentAsPreset}>
              <Text style={styles.secondaryLabel}>Save current as preset</Text>
            </Pressable>
            {settings.activeUserPresetId ? (
              <>
                <TextInput
                  style={styles.pinInput}
                  value={renameDraft}
                  onChangeText={setRenameDraft}
                  placeholder="Rename selected preset"
                  placeholderTextColor="#71717a"
                />
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    const id = settings.activeUserPresetId;
                    if (!id || !renameDraft.trim()) {
                      return;
                    }
                    setSettings((current) => renameUserPreset(current, id, renameDraft.trim()));
                    setMessage(`Renamed to “${renameDraft.trim()}”.`);
                  }}
                >
                  <Text style={styles.secondaryLabel}>Rename selected preset</Text>
                </Pressable>
              </>
            ) : null}

            <Pressable style={styles.secondaryButton} onPress={() => setRecordingsOpen(true)}>
              <Text style={styles.secondaryLabel}>Recordings</Text>
            </Pressable>

            <Text style={styles.label}>Auto-save to Photos</Text>
            <OptionRow
              options={[
                { id: 'on', label: 'On' },
                { id: 'off', label: 'Off' },
              ]}
              selected={settings.autoSaveToPhotos ? 'on' : 'off'}
              onSelect={(value) =>
                setSettings((current) => ({ ...current, autoSaveToPhotos: value === 'on' }))
              }
            />

            <Text style={styles.note}>
              Vol down starts. While recording: vol down stops
              {settings.coverPreset === 'lock'
                ? '; vol up = power (black → wake to lock)'
                : '; vol up = mark'}
              . Triple-tap top-left on cover shows timer/space. Tiny top-right tap marks.
            </Text>

            <Text style={styles.label}>Use phone regularly</Text>
            <OptionRow
              options={[
                { id: 'on', label: 'On' },
                { id: 'off', label: 'Off' },
              ]}
              selected={settings.usePhoneRegularly ? 'on' : 'off'}
              onSelect={(value) =>
                setSettings((current) => ({
                  ...current,
                  usePhoneRegularly: value === 'on',
                }))
              }
            />
            <Text style={styles.note}>
              On = vol down starts recording and jumps to your home screen. No cover — using your
              phone is the cover. Keep BlacRec in Recents.
            </Text>

            {!settings.usePhoneRegularly ? (
              <>
            <Text style={styles.label}>Cover</Text>
            <OptionRow<CoverPreset>
              options={[
                { id: 'black', label: 'Black' },
                { id: 'image', label: 'Img' },
                { id: 'text', label: 'Txt' },
                { id: 'lock', label: 'Lock' },
              ]}
              selected={settings.coverPreset}
              onSelect={(coverPreset) => setSettings((current) => ({ ...current, coverPreset }))}
            />

            {settings.coverPreset === 'image' ? (
              <>
                <Pressable style={styles.secondaryButton} onPress={() => void chooseCover()}>
                  {(settings.coverUri || coverImages[0]) ? (
                    <Image
                      source={{ uri: settings.coverUri ?? coverImages[0]! }}
                      style={styles.thumb}
                    />
                  ) : null}
                  <Text style={styles.secondaryLabel}>
                    {coverImages.length > 0 ? 'Change first picture' : 'Choose picture'}
                  </Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => void addPlaylistImages()}>
                  <Text style={styles.secondaryLabel}>
                    Add more to rotate ({coverImages.length})
                  </Text>
                </Pressable>
                {coverImages.length > 1 ? (
                  <>
                    <Text style={styles.note}>
                      Rotates every {settings.playlistSeconds}s while recording.
                    </Text>
                    <OptionRow<string>
                      options={[
                        { id: '30', label: '30s' },
                        { id: '45', label: '45s' },
                        { id: '60', label: '60s' },
                        { id: '90', label: '90s' },
                      ]}
                      selected={String(settings.playlistSeconds)}
                      onSelect={(value) =>
                        setSettings((current) => ({
                          ...current,
                          playlistSeconds: Number(value),
                        }))
                      }
                    />
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() =>
                        setSettings((current) => {
                          const first =
                            current.coverUri ?? current.playlistUris[0] ?? null;
                          return {
                            ...current,
                            coverUri: first,
                            playlistUris: first ? [first] : [],
                          };
                        })
                      }
                    >
                      <Text style={styles.secondaryLabel}>Keep only first picture</Text>
                    </Pressable>
                  </>
                ) : null}
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
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  const draft =
                    activeText ?? newTextPreset(`Text ${settings.textPresets.length + 1}`);
                  setEditorDraft(draft);
                  setEditorOpen(true);
                }}
              >
                <Text style={styles.secondaryLabel}>
                  {activeText ? 'Edit text' : 'Make text'}
                </Text>
              </Pressable>
            ) : null}

            {settings.coverPreset === 'lock' ? (
              <>
                <Pressable style={styles.secondaryButton} onPress={() => void chooseLockWallpaper()}>
                  {settings.lockWallpaperUri ? (
                    <Image source={{ uri: settings.lockWallpaperUri }} style={styles.thumb} />
                  ) : null}
                  <Text style={styles.secondaryLabel}>Lock picture</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => void chooseHomeShot()}>
                  {settings.homeShotUri ? (
                    <Image source={{ uri: settings.homeShotUri }} style={styles.thumb} />
                  ) : null}
                  <Text style={styles.secondaryLabel}>Home picture</Text>
                </Pressable>
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
                  placeholder="Fake passcode"
                  placeholderTextColor="#71717a"
                />
              </>
            ) : null}
              </>
            ) : null}

            <Text style={styles.label}>Orientation</Text>
            <OptionRow<OrientationId>
              options={[
                { id: 'portrait', label: 'Portrait' },
                { id: 'landscape', label: 'Landscape' },
                { id: 'auto', label: 'Auto' },
              ]}
              selected={settings.orientationLock}
              onSelect={(orientationLock) =>
                setSettings((current) => ({ ...current, orientationLock }))
              }
            />

            <Text style={styles.label}>
              Auto-split · {settings.splitMinutes <= 0 ? 'Off' : `${settings.splitMinutes} min`}
            </Text>
            <Slider
              style={{ width: '100%', height: 36 }}
              minimumValue={0}
              maximumValue={60}
              step={1}
              value={settings.splitMinutes}
              minimumTrackTintColor="#e4e4e7"
              maximumTrackTintColor="#3f3f46"
              thumbTintColor="#fafafa"
              onValueChange={(value) =>
                setSettings((current) => ({
                  ...current,
                  splitMinutes: Math.round(value),
                }))
              }
            />
            <Text style={styles.note}>0 = off. Splits long takes into chunks at this length.</Text>

            <Text style={styles.label}>Battery saver</Text>
            <OptionRow
              options={[
                { id: 'on', label: 'On' },
                { id: 'off', label: 'Off' },
              ]}
              selected={settings.batterySaver ? 'on' : 'off'}
              onSelect={(value) =>
                setSettings((current) => ({ ...current, batterySaver: value === 'on' }))
              }
            />

            <Text style={styles.label}>Resolution</Text>
            <OptionRow<ResolutionId>
              options={[
                { id: '720', label: '720' },
                { id: '1080', label: '1080' },
                { id: '4k', label: '4K' },
              ]}
              selected={settings.resolution}
              onSelect={(resolution) => setSettings((current) => ({ ...current, resolution }))}
            />

            <Text style={styles.label}>FPS</Text>
            <OptionRow<string>
              options={FPS_OPTIONS.map((fps) => ({ id: String(fps), label: String(fps) }))}
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

            <Text style={styles.label}>Sound</Text>
            <OptionRow
              options={[
                { id: 'off', label: 'Off' },
                { id: 'on', label: 'On' },
              ]}
              selected={settings.mic ? 'on' : 'off'}
              onSelect={(value) => void enableSound(value === 'on')}
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

            <Text style={styles.note}>
              Cover uses your phone’s current brightness. Volume up (Lock) only dims to black for
              fake power, then restores that same brightness.
            </Text>

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
            ) : null}

            {message ? <Text style={styles.message}>{message}</Text> : null}
            {saving ? <ActivityIndicator color="#fff" /> : null}
            {unsavedPath ? (
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  void (async () => {
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
                  })();
                }}
              >
                <Text style={styles.secondaryLabel}>Save to Photos</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      ) : (
        <View style={styles.cover}>
          {settings.usePhoneRegularly || settings.coverPreset === 'black' ? (
            <View style={styles.blackCover} />
          ) : null}
          {!settings.usePhoneRegularly &&
          settings.coverPreset === 'image' &&
          playlistUri ? (
            <Image
              source={{ uri: playlistUri }}
              style={styles.coverImage}
              resizeMode={settings.fit === 'fill' ? 'cover' : 'contain'}
            />
          ) : null}
          {!settings.usePhoneRegularly && settings.coverPreset === 'text' && activeText ? (
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
          {!settings.usePhoneRegularly && settings.coverPreset === 'lock' ? (
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

          {phase === 'recording' ? (
            <RecordingHud
              elapsedSec={elapsedSec}
              freeBytes={freeBytes}
              marks={marks}
              batterySaver={settings.batterySaver}
              hudVisible={hudVisible}
              onToggleHud={() => setHudVisible((v) => !v)}
              onMark={() => markRef.current()}
            />
          ) : null}
          {markFlash ? <View style={styles.markFlash} pointerEvents="none" /> : null}
        </View>
      )}

      <RecordingsLibrary visible={recordingsOpen} onClose={() => setRecordingsOpen(false)} />

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
  root: { flex: 1, backgroundColor: '#0a0a0b' },
  permissionScreen: {
    flex: 1,
    backgroundColor: '#111',
    padding: 24,
    justifyContent: 'center',
    gap: 16,
  },
  idleLayer: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 4,
    marginBottom: 4,
  },
  accountHit: {
    padding: 2,
  },
  accountAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  accountAvatarFallback: {
    backgroundColor: '#3f3f46',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountAvatarLetter: {
    color: '#fafafa',
    fontSize: 13,
    fontWeight: '700',
  },
  quotaBanner: {
    color: '#a1a1aa',
    fontSize: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  recChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(28,28,30,0.85)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  recChipDisabled: { opacity: 0.45 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#a1a1aa' },
  recChipLabel: { color: '#e4e4e7', fontSize: 13, fontWeight: '600' },
  topBarSpacer: {
    width: 52,
  },
  eyeLabel: {
    color: '#fafafa',
    fontSize: 13,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  previewEyeOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  previewWindowAbsolute: {
    position: 'absolute',
    top: 92,
    alignSelf: 'center',
    width: '72%',
    aspectRatio: 3 / 4,
    maxHeight: 240,
    borderRadius: 16,
    overflow: 'hidden',
    zIndex: 1,
  },
  previewWindowSpacer: {
    alignSelf: 'center',
    width: '72%',
    aspectRatio: 3 / 4,
    maxHeight: 240,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#111',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  previewWindowFrame: { flex: 1 },
  previewOff: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
    paddingHorizontal: 28,
  },
  previewOffLabel: {
    color: '#71717a',
    fontSize: 13,
    position: 'absolute',
    bottom: 18,
    alignSelf: 'center',
  },
  hiddenCameraHost: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: 0,
    top: 0,
    overflow: 'hidden',
  },
  panel: { flex: 1, marginTop: 10 },
  panelContent: {
    paddingHorizontal: 14,
    paddingBottom: 28,
    gap: 8,
  },
  body: { color: '#d4d4d8', fontSize: 15, lineHeight: 21 },
  label: { color: '#fff', fontSize: 13, fontWeight: '600', marginTop: 4 },
  note: { color: '#a1a1aa', fontSize: 12, lineHeight: 17 },
  warn: {
    color: '#fbbf24',
    backgroundColor: 'rgba(120,53,15,0.35)',
    borderRadius: 10,
    padding: 10,
    fontSize: 12,
    lineHeight: 17,
  },
  tipBox: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  tipTitle: { color: '#fff', fontWeight: '700', fontSize: 14 },
  tipDismiss: { color: '#60a5fa', fontWeight: '600', marginTop: 2 },
  message: {
    color: '#fff',
    backgroundColor: '#27272a',
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
  },
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a2a2e',
    paddingHorizontal: 4,
  },
  chipActive: { backgroundColor: '#e4e4e7' },
  chipLabel: { color: '#f4f4f5', fontSize: 12, fontWeight: '600' },
  chipLabelActive: { color: '#111' },
  presetChipOn: {
    backgroundColor: '#fafafa',
    borderColor: '#fafafa',
  },
  presetChipLabelOn: {
    color: '#0a0a0a',
  },
  presetChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  presetChipLabel: { color: '#e5e7eb', fontSize: 12, fontWeight: '700' },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#2a2a2e',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
  },
  secondaryLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  thumb: { width: 34, height: 34, borderRadius: 7, backgroundColor: '#000' },
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
  cover: { ...StyleSheet.absoluteFill, backgroundColor: '#000', zIndex: 30 },
  coverImage: { width: '100%', height: '100%', backgroundColor: '#000' },
  blackCover: { ...StyleSheet.absoluteFill, backgroundColor: '#000' },
  markFlash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
});
