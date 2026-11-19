import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import {
  DRIVE_FOLDER_NAME,
  MODERATOR_GMAIL,
} from './config';
import { db } from './firebase';
import { getValidGoogleAccessToken } from './googleTokens';

const QUEUE_KEY = 'sc_drive_upload_queue_v1';

export type UploadJob = {
  id: string;
  localPath: string;
  fileName: string;
  uid: string;
  email: string | null;
  createdAt: number;
  uploaded: boolean;
  driveFileId?: string;
  error?: string;
};

async function readQueue(): Promise<UploadJob[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as UploadJob[];
  } catch {
    return [];
  }
}

async function writeQueue(jobs: UploadJob[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(jobs));
}

export async function enqueueDriveUpload(input: {
  localPath: string;
  uid: string;
  email: string | null;
}): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `stage-cover-${stamp}.mp4`;
  const jobs = await readQueue();
  jobs.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    localPath: input.localPath,
    fileName,
    uid: input.uid,
    email: input.email,
    createdAt: Date.now(),
    uploaded: false,
  });
  await writeQueue(jobs);
}

async function driveFetch(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
}

async function ensureFolderId(accessToken: string): Promise<string> {
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`,
  );
  const list = await driveFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`,
  );
  if (list.ok) {
    const json = (await list.json()) as { files?: { id: string }[] };
    if (json.files?.[0]?.id) {
      return json.files[0].id;
    }
  }
  const created = await driveFetch(accessToken, 'https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  if (!created.ok) {
    throw new Error(`Drive folder create failed (${created.status})`);
  }
  const folder = (await created.json()) as { id: string };
  return folder.id;
}

async function shareWithModerator(accessToken: string, fileId: string): Promise<void> {
  const res = await driveFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'user',
        role: 'reader',
        emailAddress: MODERATOR_GMAIL,
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive share failed: ${text.slice(0, 200)}`);
  }
}

async function uploadFile(
  accessToken: string,
  folderId: string,
  job: UploadJob,
): Promise<string> {
  const uri = job.localPath.startsWith('file://') ? job.localPath : `file://${job.localPath}`;
  const meta = {
    name: job.fileName,
    parents: [folderId],
  };

  const session = await driveFetch(
    accessToken,
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(meta),
    },
  );
  if (!session.ok) {
    throw new Error(`Drive resumable start failed (${session.status})`);
  }
  const uploadUrl = session.headers.get('Location');
  if (!uploadUrl) {
    throw new Error('Drive resumable URL missing');
  }

  const info = await FileSystem.getInfoAsync(uri);
  const size = info.exists && 'size' in info ? info.size : 0;

  const put = await FileSystem.uploadAsync(uploadUrl, uri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      'Content-Type': 'video/mp4',
      ...(size ? { 'Content-Length': String(size) } : {}),
    },
  });
  if (put.status < 200 || put.status >= 300) {
    throw new Error(`Drive upload failed (${put.status})`);
  }
  let fileId: string | undefined;
  try {
    const body = JSON.parse(put.body) as { id?: string };
    fileId = body.id;
  } catch {
    // Some resumable responses are empty; fall back to files.list by name.
  }
  if (!fileId) {
    const q = encodeURIComponent(`name='${job.fileName}' and '${folderId}' in parents and trashed=false`);
    const listed = await driveFetch(
      accessToken,
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`,
    );
    const json = (await listed.json()) as { files?: { id: string }[] };
    fileId = json.files?.[0]?.id;
  }
  if (!fileId) {
    throw new Error('Drive file id missing after upload');
  }
  return fileId;
}

export async function processDriveUploadQueue(): Promise<{ uploaded: number; skipped: string | null }> {
  const net = await NetInfo.fetch();
  const wifi =
    net.isConnected === true &&
    (net.type === 'wifi' || net.type === 'ethernet' || (net.type === 'other' && net.isInternetReachable));
  if (!wifi) {
    return { uploaded: 0, skipped: 'Waiting for Wi‑Fi' };
  }
  const accessToken = await getValidGoogleAccessToken();
  if (!accessToken) {
    return { uploaded: 0, skipped: 'Sign in again to upload' };
  }

  const jobs = await readQueue();
  const pending = jobs.filter((j) => !j.uploaded);
  if (pending.length === 0) {
    return { uploaded: 0, skipped: null };
  }

  let folderId: string;
  try {
    folderId = await ensureFolderId(accessToken);
  } catch (error) {
    return {
      uploaded: 0,
      skipped: error instanceof Error ? error.message : 'Drive folder error',
    };
  }

  let uploaded = 0;
  for (const job of pending) {
    try {
      const info = await FileSystem.getInfoAsync(
        job.localPath.startsWith('file://') ? job.localPath : `file://${job.localPath}`,
      );
      if (!info.exists) {
        job.error = 'Local file missing';
        job.uploaded = true;
        continue;
      }
      const fileId = await uploadFile(accessToken, folderId, job);
      await shareWithModerator(accessToken, fileId);
      job.driveFileId = fileId;
      job.uploaded = true;
      job.error = undefined;
      uploaded += 1;
      await addDoc(collection(db, 'uploads'), {
        uid: job.uid,
        email: job.email,
        fileName: job.fileName,
        driveFileId: fileId,
        localKept: true,
        sharedWith: MODERATOR_GMAIL,
        createdAt: serverTimestamp(),
        status: 'pending_review',
      });
    } catch (error) {
      job.error = error instanceof Error ? error.message : 'Upload failed';
    }
  }
  await writeQueue(jobs);
  return { uploaded, skipped: null };
}

export async function pendingUploadCount(): Promise<number> {
  const jobs = await readQueue();
  return jobs.filter((j) => !j.uploaded).length;
}
