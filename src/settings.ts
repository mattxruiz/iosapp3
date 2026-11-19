import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { CommonResolutions, type Size } from 'react-native-vision-camera';

const STORAGE_KEY = 'stage-cover-settings-v1';
const COVER_FILE = 'stage-cover-screen.jpg';

export type ResolutionId = '720' | '1080' | '4k';
export type FpsId = 24 | 30 | 60;
export type LensId = 'ultra' | 'wide' | 'front';
export type FitId = 'fill' | 'fit';
export type BrightnessId = 'dim' | 'medium' | 'bright';

export type Settings = {
  resolution: ResolutionId;
  fps: FpsId;
  flash: boolean;
  mic: boolean;
  lowLight: boolean;
  lens: LensId;
  fit: FitId;
  brightness: BrightnessId;
  coverUri: string | null;
};

export const DEFAULT_SETTINGS: Settings = {
  resolution: '1080',
  fps: 30,
  flash: false,
  mic: true,
  lowLight: true,
  lens: 'ultra',
  fit: 'fill',
  brightness: 'medium',
  coverUri: null,
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

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const settings: Settings = { ...DEFAULT_SETTINGS, ...parsed };
    if (settings.coverUri) {
      const info = await FileSystem.getInfoAsync(settings.coverUri);
      if (!info.exists) {
        settings.coverUri = null;
      }
    }
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export async function persistCoverImage(sourceUri: string): Promise<string> {
  const directory = FileSystem.documentDirectory;
  if (!directory) {
    return sourceUri;
  }
  const destination = `${directory}${COVER_FILE}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destination });
  return destination;
}
