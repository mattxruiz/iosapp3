import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { CommonResolutions, type Size } from 'react-native-vision-camera';

const STORAGE_KEY = 'stage-cover-settings-v4';
const COVER_FILE = 'stage-cover-screen.jpg';
const LOCK_WALL_FILE = 'stage-lock-wallpaper.jpg';
const HOME_SHOT_FILE = 'stage-home-shot.jpg';

export type ResolutionId = '720' | '1080' | '4k';
export type FpsId = 24 | 30 | 60;
export type LensId = 'ultra' | 'wide' | 'front';
export type FitId = 'fill' | 'fit';
export type BrightnessId = 'dim' | 'medium' | 'bright';
export type OrientationId = 'auto' | 'portrait' | 'landscape';
export type SplitMinutes = 0 | 10 | 15 | 20 | 30;
export type CoverPreset =
  | 'image'
  | 'black'
  | 'text'
  | 'lock'
  | 'playlist'
  | 'messages'
  | 'notes'
  | 'spotify'
  | 'calculator'
  | 'clock';

export type TextLayer = {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
};

export type TextPreset = {
  id: string;
  name: string;
  background: string;
  layers: TextLayer[];
};

export type Settings = {
  resolution: ResolutionId;
  fps: FpsId;
  flash: boolean;
  mic: boolean;
  lowLight: boolean;
  lens: LensId;
  fit: FitId;
  brightness: BrightnessId;
  coverPreset: CoverPreset;
  coverUri: string | null;
  showPreview: boolean;
  textPresets: TextPreset[];
  activeTextPresetId: string | null;
  lockWallpaperUri: string | null;
  homeShotUri: string | null;
  lockPin: string;
  appLockEnabled: boolean;
  appLockPin: string;
  orientationLock: OrientationId;
  batterySaver: boolean;
  splitMinutes: SplitMinutes;
  playlistUris: string[];
  playlistSeconds: number;
  tipsDismissed: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  resolution: '1080',
  fps: 30,
  flash: false,
  mic: false,
  lowLight: true,
  lens: 'ultra',
  fit: 'fill',
  brightness: 'medium',
  coverPreset: 'black',
  coverUri: null,
  showPreview: true,
  textPresets: [],
  activeTextPresetId: null,
  lockWallpaperUri: null,
  homeShotUri: null,
  lockPin: '',
  appLockEnabled: false,
  appLockPin: '',
  orientationLock: 'portrait',
  batterySaver: true,
  splitMinutes: 20,
  playlistUris: [],
  playlistSeconds: 45,
  tipsDismissed: false,
};

export const RESOLUTION_SIZE: Record<ResolutionId, Size> = {
  '720': CommonResolutions.HD_16_9,
  '1080': CommonResolutions.FHD_16_9,
  '4k': CommonResolutions.UHD_16_9,
};

export const BRIGHTNESS_VALUE: Record<BrightnessId, number> = {
  dim: 0.18,
  medium: 0.42,
  bright: 0.75,
};

export const SKIN_PRESETS: CoverPreset[] = [
  'messages',
  'notes',
  'spotify',
  'calculator',
  'clock',
];

async function fileOrNull(uri: string | null | undefined): Promise<string | null> {
  if (!uri) {
    return null;
  }
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? uri : null;
  } catch {
    return null;
  }
}

async function filesOrEmpty(uris: string[] | undefined): Promise<string[]> {
  if (!Array.isArray(uris)) {
    return [];
  }
  const kept: string[] = [];
  for (const uri of uris) {
    const ok = await fileOrNull(uri);
    if (ok) {
      kept.push(ok);
    }
  }
  return kept;
}

function migrate(raw: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    lockPin: typeof raw.lockPin === 'string' ? raw.lockPin.replace(/[^0-9]/g, '').slice(0, 6) : '',
    appLockPin:
      typeof raw.appLockPin === 'string' ? raw.appLockPin.replace(/[^0-9]/g, '').slice(0, 6) : '',
    textPresets: Array.isArray(raw.textPresets) ? raw.textPresets : [],
    playlistUris: Array.isArray(raw.playlistUris) ? raw.playlistUris : [],
    playlistSeconds:
      typeof raw.playlistSeconds === 'number' && raw.playlistSeconds >= 10
        ? raw.playlistSeconds
        : DEFAULT_SETTINGS.playlistSeconds,
    splitMinutes: ([0, 10, 15, 20, 30] as SplitMinutes[]).includes(
      raw.splitMinutes as SplitMinutes,
    )
      ? (raw.splitMinutes as SplitMinutes)
      : DEFAULT_SETTINGS.splitMinutes,
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw =
      (await AsyncStorage.getItem(STORAGE_KEY)) ??
      (await AsyncStorage.getItem('stage-cover-settings-v3')) ??
      (await AsyncStorage.getItem('stage-cover-settings-v2')) ??
      (await AsyncStorage.getItem('stage-cover-settings-v1'));
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const parsed = migrate(JSON.parse(raw) as Partial<Settings>);
    return {
      ...parsed,
      coverUri: await fileOrNull(parsed.coverUri),
      lockWallpaperUri: await fileOrNull(parsed.lockWallpaperUri),
      homeShotUri: await fileOrNull(parsed.homeShotUri),
      playlistUris: await filesOrEmpty(parsed.playlistUris),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

async function persistNamedImage(sourceUri: string, fileName: string): Promise<string> {
  const directory = FileSystem.documentDirectory;
  if (!directory) {
    return sourceUri;
  }
  const destination = `${directory}${fileName}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destination });
  return destination;
}

export async function persistCoverImage(sourceUri: string): Promise<string> {
  return persistNamedImage(sourceUri, COVER_FILE);
}

export async function persistLockWallpaper(sourceUri: string): Promise<string> {
  return persistNamedImage(sourceUri, LOCK_WALL_FILE);
}

export async function persistHomeShot(sourceUri: string): Promise<string> {
  return persistNamedImage(sourceUri, HOME_SHOT_FILE);
}

export async function persistPlaylistImage(sourceUri: string, index: number): Promise<string> {
  return persistNamedImage(sourceUri, `stage-playlist-${index}-${Date.now()}.jpg`);
}

export function newTextPreset(name = 'My text'): TextPreset {
  return {
    id: `text-${Date.now()}`,
    name,
    background: '#000000',
    layers: [
      {
        id: `layer-${Date.now()}`,
        text: '@yourhandle',
        x: 0.5,
        y: 0.45,
        size: 34,
        color: '#ffffff',
      },
    ],
  };
}

export function coverReady(settings: Settings): boolean {
  if (
    settings.coverPreset === 'black' ||
    SKIN_PRESETS.includes(settings.coverPreset)
  ) {
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
  if (settings.coverPreset === 'playlist') {
    return settings.playlistUris.length > 0;
  }
  return Boolean(
    settings.lockWallpaperUri && settings.homeShotUri && settings.lockPin.length >= 4,
  );
}

export type ShowPresetId = 'school' | 'silent' | 'social';

export function applyShowPreset(settings: Settings, id: ShowPresetId): Settings {
  if (id === 'school') {
    return {
      ...settings,
      resolution: '1080',
      fps: 30,
      lens: 'ultra',
      mic: true,
      flash: false,
      lowLight: true,
      batterySaver: true,
      splitMinutes: 20,
      orientationLock: 'portrait',
      coverPreset:
        settings.lockWallpaperUri && settings.homeShotUri && settings.lockPin.length >= 4
          ? 'lock'
          : 'black',
      brightness: 'dim',
    };
  }
  if (id === 'silent') {
    return {
      ...settings,
      resolution: '1080',
      fps: 30,
      lens: 'ultra',
      mic: false,
      flash: false,
      coverPreset: 'black',
      batterySaver: true,
      splitMinutes: 20,
      orientationLock: 'portrait',
      brightness: 'dim',
    };
  }
  return {
    ...settings,
    resolution: '1080',
    fps: 30,
    lens: 'wide',
    mic: true,
    flash: false,
    coverPreset: settings.coverUri ? 'image' : 'messages',
    fit: 'fill',
    batterySaver: true,
    splitMinutes: 15,
    orientationLock: 'portrait',
    brightness: 'medium',
  };
}

export function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(1)} GB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${Math.max(0, Math.round(mb))} MB`;
}

export function formatTimer(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
