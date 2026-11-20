import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import {
  createAssetAsync,
  deleteAssetsAsync,
  getAssetInfoAsync,
  requestPermissionsAsync,
} from 'expo-media-library/legacy';

const INDEX_KEY = 'sc_recordings_index_v1';

export type RecordingMarker = {
  id: string;
  /** Seconds from start */
  sec: number;
  label?: string;
  /** Locked begin/end markers cannot be deleted */
  locked?: boolean;
};

export type AppRecording = {
  id: string;
  fileName: string;
  localPath: string;
  createdAt: number;
  durationSec: number;
  markers: RecordingMarker[];
  photosAssetId: string | null;
};

function recordingsDir(): string {
  const root = FileSystem.documentDirectory;
  if (!root) {
    throw new Error('No document directory');
  }
  return `${root}recordings/`;
}

async function ensureDir(): Promise<string> {
  const dir = recordingsDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

async function readIndex(): Promise<AppRecording[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as AppRecording[];
  } catch {
    return [];
  }
}

async function writeIndex(items: AppRecording[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(items));
}

export function defaultMarkers(durationSec: number): RecordingMarker[] {
  const end = Math.max(0, Math.floor(durationSec));
  return [
    { id: 'begin', sec: 0, label: 'Start', locked: true },
    { id: 'end', sec: end, label: 'End', locked: true },
  ];
}

export function normalizeMarkers(
  markers: RecordingMarker[],
  durationSec: number,
): RecordingMarker[] {
  const end = Math.max(0, Math.floor(durationSec));
  const middle = markers
    .filter((m) => m.id !== 'begin' && m.id !== 'end' && !m.locked)
    .map((m) => ({
      ...m,
      sec: Math.max(0, Math.min(end, Math.floor(m.sec))),
    }))
    .sort((a, b) => a.sec - b.sec);
  return [
    { id: 'begin', sec: 0, label: 'Start', locked: true },
    ...middle,
    { id: 'end', sec: end, label: 'End', locked: true },
  ];
}

export async function listRecordings(): Promise<AppRecording[]> {
  const items = await readIndex();
  const kept: AppRecording[] = [];
  for (const item of items) {
    const uri = item.localPath.startsWith('file://') ? item.localPath : `file://${item.localPath}`;
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      kept.push({
        ...item,
        markers: normalizeMarkers(item.markers ?? [], item.durationSec),
      });
    }
  }
  if (kept.length !== items.length) {
    await writeIndex(kept);
  }
  return kept.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getRecording(id: string): Promise<AppRecording | null> {
  const items = await listRecordings();
  return items.find((item) => item.id === id) ?? null;
}

export async function ingestRecording(input: {
  sourcePath: string;
  durationSec: number;
  marks: number[];
  photosAssetId?: string | null;
}): Promise<AppRecording> {
  const dir = await ensureDir();
  const id = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const fileName = `${id}.mp4`;
  const dest = `${dir}${fileName}`;
  const from = input.sourcePath.startsWith('file://')
    ? input.sourcePath
    : `file://${input.sourcePath}`;
  await FileSystem.copyAsync({ from, to: dest });

  const durationSec = Math.max(0, Math.floor(input.durationSec));
  const middle = input.marks
    .map((sec) => Math.max(0, Math.min(durationSec, Math.floor(sec))))
    .filter((sec) => sec > 0 && sec < durationSec)
    .map((sec, index) => ({
      id: `m-${Date.now()}-${index}`,
      sec,
      label: `Mark ${index + 1}`,
    }));

  const recording: AppRecording = {
    id,
    fileName,
    localPath: dest,
    createdAt: Date.now(),
    durationSec,
    markers: normalizeMarkers(middle, durationSec),
    photosAssetId: input.photosAssetId ?? null,
  };

  const items = await readIndex();
  items.unshift(recording);
  await writeIndex(items);
  return recording;
}

export async function updateRecordingMarkers(
  id: string,
  markers: RecordingMarker[],
): Promise<AppRecording | null> {
  const items = await readIndex();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) {
    return null;
  }
  const next = {
    ...items[index]!,
    markers: normalizeMarkers(markers, items[index]!.durationSec),
  };
  items[index] = next;
  await writeIndex(items);
  return next;
}

export async function setRecordingPhotosAsset(
  id: string,
  photosAssetId: string | null,
): Promise<void> {
  const items = await readIndex();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) {
    return;
  }
  items[index] = { ...items[index]!, photosAssetId };
  await writeIndex(items);
}

export async function saveRecordingToPhotos(recording: AppRecording): Promise<string> {
  const permission = await requestPermissionsAsync(true, ['video']);
  if (!permission.granted) {
    throw new Error('Photos access was denied.');
  }
  const uri = recording.localPath.startsWith('file://')
    ? recording.localPath
    : `file://${recording.localPath}`;
  const asset = await createAssetAsync(uri);
  await setRecordingPhotosAsset(recording.id, asset.id);
  return asset.id;
}

/**
 * Save a time range. Without a native trimmer we remux by copying the full file
 * when the range is the whole take; otherwise we still export the full take to
 * Photos and return which range the user picked (markers stay authoritative).
 */
export async function saveRecordingRangeToPhotos(
  recording: AppRecording,
  startSec: number,
  endSec: number,
): Promise<{ assetId: string; clipped: boolean }> {
  const start = Math.max(0, Math.floor(startSec));
  const end = Math.max(start + 1, Math.floor(endSec));
  const whole = start <= 0 && end >= recording.durationSec - 1;
  const assetId = await saveRecordingToPhotos(recording);
  return { assetId, clipped: !whole };
}

export async function deleteRecording(
  recording: AppRecording,
  deletePhotosCopy: boolean,
): Promise<void> {
  if (deletePhotosCopy && recording.photosAssetId) {
    try {
      await getAssetInfoAsync(recording.photosAssetId);
      await deleteAssetsAsync([recording.photosAssetId]);
    } catch {
      // Photos copy may already be gone.
    }
  }
  const uri = recording.localPath.startsWith('file://')
    ? recording.localPath
    : `file://${recording.localPath}`;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  const items = (await readIndex()).filter((item) => item.id !== recording.id);
  await writeIndex(items);
}

export function formatRecordingStamp(createdAt: number): string {
  try {
    return new Date(createdAt).toLocaleString();
  } catch {
    return String(createdAt);
  }
}
