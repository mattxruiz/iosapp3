import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { CommonResolutions, type Size } from 'react-native-vision-camera';

const STORAGE_KEY = 'blacrec-settings-v5';
const COVER_FILE = 'blacrec-screen.jpg';
const LOCK_WALL_FILE = 'blacrec-lock-wallpaper.jpg';
const HOME_SHOT_FILE = 'blacrec-home-shot.jpg';

export type ResolutionId = '720' | '1080' | '4k';
export type FpsId = 24 | 30 | 60;
export type LensId = 'ultra' | 'wide' | 'front';
export type FitId = 'fill' | 'fit';
export type BrightnessId = 'dim' | 'medium' | 'bright';
export type OrientationId = 'auto' | 'portrait' | 'landscape';
/** 0 = off; otherwise minutes between auto-splits (1–60). */
export type SplitMinutes = number;
export type CoverPreset = 'image' | 'black' | 'text' | 'lock' | 'playlist';

const LEGACY_SKINS = new Set(['messages', 'notes', 'spotify', 'calculator', 'clock']);

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

/** Snapshot of camera/cover settings the user can load later. */
export type UserPreset = {
  id: string;
  name: string;
  updatedAt: number;
  snapshot: Omit<
    Settings,
    'userPresets' | 'activeUserPresetId' | 'tipsDismissed' | 'appLockPin' | 'appLockEnabled'
  >;
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
  autoSaveToPhotos: boolean;
  /** Keep recording when user leaves the app to use the phone normally. */
  usePhoneRegularly: boolean;
  userPresets: UserPreset[];
  activeUserPresetId: string | null;
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
  autoSaveToPhotos: true,
  usePhoneRegularly: false,
  userPresets: [],
  activeUserPresetId: null,
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

function clampSplit(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(60, Math.round(n)));
}

function migrate(raw: Partial<Settings>): Settings {
  const coverPreset = LEGACY_SKINS.has(String(raw.coverPreset))
    ? 'black'
    : (raw.coverPreset as CoverPreset | undefined);
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    coverPreset: coverPreset ?? DEFAULT_SETTINGS.coverPreset,
    lockPin: typeof raw.lockPin === 'string' ? raw.lockPin.replace(/[^0-9]/g, '').slice(0, 6) : '',
    appLockPin:
      typeof raw.appLockPin === 'string' ? raw.appLockPin.replace(/[^0-9]/g, '').slice(0, 6) : '',
    textPresets: Array.isArray(raw.textPresets) ? raw.textPresets : [],
    playlistUris: Array.isArray(raw.playlistUris) ? raw.playlistUris : [],
    playlistSeconds:
      typeof raw.playlistSeconds === 'number' && raw.playlistSeconds >= 10
        ? raw.playlistSeconds
        : DEFAULT_SETTINGS.playlistSeconds,
    splitMinutes: clampSplit(raw.splitMinutes ?? DEFAULT_SETTINGS.splitMinutes),
    autoSaveToPhotos:
      typeof raw.autoSaveToPhotos === 'boolean'
        ? raw.autoSaveToPhotos
        : DEFAULT_SETTINGS.autoSaveToPhotos,
    usePhoneRegularly:
      typeof raw.usePhoneRegularly === 'boolean'
        ? raw.usePhoneRegularly
        : DEFAULT_SETTINGS.usePhoneRegularly,
    userPresets: Array.isArray(raw.userPresets) ? raw.userPresets : [],
    activeUserPresetId:
      typeof raw.activeUserPresetId === 'string' ? raw.activeUserPresetId : null,
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw =
      (await AsyncStorage.getItem(STORAGE_KEY)) ??
      (await AsyncStorage.getItem('stage-cover-settings-v5')) ??
      (await AsyncStorage.getItem('stage-cover-settings-v4')) ??
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
  return persistNamedImage(sourceUri, `blacrec-playlist-${index}-${Date.now()}.jpg`);
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
  if (settings.coverPreset === 'playlist') {
    return settings.playlistUris.length > 0;
  }
  return Boolean(
    settings.lockWallpaperUri && settings.homeShotUri && settings.lockPin.length >= 4,
  );
}

function snapshotFromSettings(settings: Settings): UserPreset['snapshot'] {
  const {
    userPresets: _u,
    activeUserPresetId: _a,
    tipsDismissed: _t,
    appLockPin: _p,
    appLockEnabled: _e,
    ...rest
  } = settings;
  return rest;
}

export function applyUserPreset(settings: Settings, preset: UserPreset): Settings {
  const snap = { ...preset.snapshot };
  if (LEGACY_SKINS.has(String(snap.coverPreset))) {
    snap.coverPreset = 'black';
  }
  return {
    ...settings,
    ...snap,
    userPresets: settings.userPresets,
    activeUserPresetId: preset.id,
    tipsDismissed: settings.tipsDismissed,
    appLockPin: settings.appLockPin,
    appLockEnabled: settings.appLockEnabled,
  };
}

/** Save current settings under name; same name overwrites. */
export function saveUserPreset(settings: Settings, name: string): Settings {
  const trimmed = name.trim();
  if (!trimmed) {
    return settings;
  }
  const existing = settings.userPresets.find(
    (item) => item.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const preset: UserPreset = {
    id: existing?.id ?? `preset-${Date.now()}`,
    name: trimmed,
    updatedAt: Date.now(),
    snapshot: snapshotFromSettings(settings),
  };
  const others = settings.userPresets.filter(
    (item) => item.name.toLowerCase() !== trimmed.toLowerCase(),
  );
  return {
    ...settings,
    userPresets: [preset, ...others],
    activeUserPresetId: preset.id,
  };
}

export function renameUserPreset(settings: Settings, id: string, name: string): Settings {
  const trimmed = name.trim();
  if (!trimmed) {
    return settings;
  }
  const clash = settings.userPresets.find(
    (item) => item.id !== id && item.name.toLowerCase() === trimmed.toLowerCase(),
  );
  let presets = settings.userPresets.map((item) =>
    item.id === id ? { ...item, name: trimmed, updatedAt: Date.now() } : item,
  );
  if (clash) {
    // Overwrite: drop the other preset with that name, keep edited one.
    presets = presets.filter((item) => item.id !== clash.id);
  }
  return { ...settings, userPresets: presets };
}

export function deleteUserPreset(settings: Settings, id: string): Settings {
  return {
    ...settings,
    userPresets: settings.userPresets.filter((item) => item.id !== id),
    activeUserPresetId: settings.activeUserPresetId === id ? null : settings.activeUserPresetId,
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
