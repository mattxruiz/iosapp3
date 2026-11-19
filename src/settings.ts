import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { CommonResolutions, type Size } from 'react-native-vision-camera';

const STORAGE_KEY = 'stage-cover-settings-v3';
const COVER_FILE = 'stage-cover-screen.jpg';
const LOCK_WALL_FILE = 'stage-lock-wallpaper.jpg';
const HOME_SHOT_FILE = 'stage-home-shot.jpg';

export type ResolutionId = '720' | '1080' | '4k';
export type FpsId = 24 | 30 | 60;
export type LensId = 'ultra' | 'wide' | 'front';
export type FitId = 'fill' | 'fit';
export type BrightnessId = 'dim' | 'medium' | 'bright';
export type CoverPreset = 'image' | 'black' | 'text' | 'lock';

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
  coverPreset: 'image',
  coverUri: null,
  showPreview: true,
  textPresets: [],
  activeTextPresetId: null,
  lockWallpaperUri: null,
  homeShotUri: null,
  lockPin: '',
  appLockEnabled: false,
  appLockPin: '',
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

function migrate(raw: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    lockPin: typeof raw.lockPin === 'string' ? raw.lockPin.replace(/[^0-9]/g, '').slice(0, 6) : '',
    appLockPin:
      typeof raw.appLockPin === 'string' ? raw.appLockPin.replace(/[^0-9]/g, '').slice(0, 6) : '',
    textPresets: Array.isArray(raw.textPresets) ? raw.textPresets : [],
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw =
      (await AsyncStorage.getItem(STORAGE_KEY)) ??
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
