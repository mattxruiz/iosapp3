import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { DRIVE_FOLDER_NAME, MODERATOR_GMAIL } from './config';
import { db } from './firebase';
import { getValidGoogleAccessToken } from './googleTokens';

const QUEUE_KEY = 'sc_drive_upload_queue_v2';
const RING_KEY = 'sc_drive_ring_v1';

export type DriveRingStatus = 'idle' | 'uploading' | 'success' | 'error';

export type DriveRingState = {
  status: DriveRingStatus;
  /** 0–1 overall queue progress */
  progress: number;
};

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
  /** Google resumable session URL — resume if still valid, else restart */
  sessionUrl?: string;
};

type Listener = (state: DriveRingState) => void;

const listeners = new Set<Listener>();
let ringState: DriveRingState = { status: 'idle', progress: 0 };
let processing = false;

function emit(next: DriveRingState) {
  ringState = next;
  listeners.forEach((fn) => fn(next));
  void AsyncStorage.setItem(RING_KEY, JSON.stringify(next)).catch(() => {});
}

export function getDriveRingState(): DriveRingState {
  return ringState;
}

export function subscribeDriveRing(listener: Listener): () => void {
  listeners.add(listener);
  listener(ringState);
  return () => {
    listeners.delete(listener);
  };
}

export async function hydrateDriveRing(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(RING_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DriveRingState;
      if (parsed?.status) {
        ringState = {
          status: parsed.status,
          progress: Math.max(0, Math.min(1, Number(parsed.progress) || 0)),
        };
        listeners.forEach((fn) => fn(ringState));
      }
    }
  } catch {
    // ignore
  }
  const jobs = await readQueue();
  const pending = jobs.filter((j) => !j.uploaded);
  if (pending.length > 0) {
    const hasError = pending.some((j) => Boolean(j.error));
    emit({
      status: hasError ? 'error' : 'uploading',
      progress: ringState.progress > 0 && ringState.progress < 1 ? ringState.progress : 0,
    });
  }
}

async function readQueue(): Promise<UploadJob[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) {
    // Migrate v1 queue if present.
    const legacy = await AsyncStorage.getItem('sc_drive_upload_queue_v1');
    if (!legacy) {
      return [];
    }
    try {
      const jobs = JSON.parse(legacy) as UploadJob[];
      await writeQueue(jobs);
      await AsyncStorage.removeItem('sc_drive_upload_queue_v1');
      return jobs;
    } catch {
      return [];
    }
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
  const fileName = `blacrec-${stamp}.mp4`;
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
  emit({ status: 'uploading', progress: 0 });
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
        role: 'writer',
        emailAddress: MODERATOR_GMAIL,
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive share failed: ${text.slice(0, 200)}`);
  }
}

/** Returns true if session still accepts a full restart PUT (or we should start new). */
async function sessionStillValid(sessionUrl: string, accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(sessionUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Length': '0',
        'Content-Range': 'bytes */*',
      },
    });
    // 308 = incomplete (resume possible); 200/201 = already done
    return res.status === 308 || res.status === 200 || res.status === 201;
  } catch {
    return false;
  }
}

async function startResumableSession(
  accessToken: string,
  folderId: string,
  job: UploadJob,
): Promise<string> {
  const meta = {
    name: job.fileName,
    parents: [folderId],
  };
  const session = await driveFetch(
    accessToken,
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',
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
  return uploadUrl;
}

async function uploadFile(
  accessToken: string,
  folderId: string,
  job: UploadJob,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const uri = job.localPath.startsWith('file://') ? job.localPath : `file://${job.localPath}`;
  let sessionUrl = job.sessionUrl;

  if (sessionUrl) {
    const ok = await sessionStillValid(sessionUrl, accessToken);
    if (!ok) {
      sessionUrl = undefined;
      job.sessionUrl = undefined;
    }
  }

  // Partial byte resume is unreliable with full-file uploadAsync; restart body upload
  // on a fresh or still-valid session URL.
  if (!sessionUrl) {
    sessionUrl = await startResumableSession(accessToken, folderId, job);
    job.sessionUrl = sessionUrl;
  }

  const info = await FileSystem.getInfoAsync(uri);
  const size = info.exists && 'size' in info ? Number(info.size) : 0;

  const task = FileSystem.createUploadTask(
    sessionUrl,
    uri,
    {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        'Content-Type': 'video/mp4',
        ...(size ? { 'Content-Length': String(size) } : {}),
      },
    },
    (data) => {
      const total = data.totalBytesExpectedToSend || size || 0;
      if (total > 0) {
        onProgress(Math.min(1, data.totalBytesSent / total));
      }
    },
  );

  const put = await task.uploadAsync();
  if (!put || put.status < 200 || put.status >= 300) {
    throw new Error(`Drive upload failed (${put?.status ?? 'no response'})`);
  }

  let fileId: string | undefined;
  try {
    const body = JSON.parse(put.body) as { id?: string };
    fileId = body.id;
  } catch {
    // fall through
  }
  if (!fileId) {
    const q = encodeURIComponent(
      `name='${job.fileName}' and '${folderId}' in parents and trashed=false`,
    );
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

export async function processDriveUploadQueue(): Promise<void> {
  if (processing) {
    return;
  }
  processing = true;
  try {
    const net = await NetInfo.fetch();
    const wifi =
      net.isConnected === true &&
      (net.type === 'wifi' ||
        net.type === 'ethernet' ||
        (net.type === 'other' && net.isInternetReachable));
    if (!wifi) {
      const jobs = await readQueue();
      if (jobs.some((j) => !j.uploaded)) {
        emit({
          status: jobs.some((j) => j.error) ? 'error' : ringState.status === 'success' ? 'success' : 'uploading',
          progress: ringState.progress,
        });
      }
      return;
    }

    const accessToken = await getValidGoogleAccessToken();
    if (!accessToken) {
      const jobs = await readQueue();
      if (jobs.some((j) => !j.uploaded)) {
        emit({ status: 'error', progress: ringState.progress });
      }
      return;
    }

    let jobs = await readQueue();
    const pending = jobs.filter((j) => !j.uploaded);
    if (pending.length === 0) {
      if (ringState.status === 'uploading') {
        emit({ status: 'success', progress: 1 });
      }
      return;
    }

    emit({ status: 'uploading', progress: ringState.progress });

    let folderId: string;
    try {
      folderId = await ensureFolderId(accessToken);
    } catch {
      emit({ status: 'error', progress: ringState.progress });
      return;
    }

    const total = pending.length;
    let completed = 0;

    for (const job of pending) {
      job.error = undefined;
      try {
        const info = await FileSystem.getInfoAsync(
          job.localPath.startsWith('file://') ? job.localPath : `file://${job.localPath}`,
        );
        if (!info.exists) {
          job.error = 'Local file missing';
          job.uploaded = true;
          completed += 1;
          await writeQueue(jobs);
          continue;
        }

        const fileId = await uploadFile(accessToken, folderId, job, (fraction) => {
          const overall = (completed + fraction) / total;
          emit({ status: 'uploading', progress: overall });
        });
        await shareWithModerator(accessToken, fileId);
        job.driveFileId = fileId;
        job.uploaded = true;
        job.sessionUrl = undefined;
        job.error = undefined;
        completed += 1;
        emit({ status: 'uploading', progress: completed / total });
        await writeQueue(jobs);
        await addDoc(collection(db, 'uploads'), {
          uid: job.uid,
          email: job.email,
          fileName: job.fileName,
          driveFileId: fileId,
          localKept: true,
          sharedWith: MODERATOR_GMAIL,
          createdAt: serverTimestamp(),
          status: 'pending_review',
        }).catch(() => {});
      } catch (error) {
        job.error = error instanceof Error ? error.message : 'Upload failed';
        job.sessionUrl = undefined; // force fresh session next attempt
        await writeQueue(jobs);
        emit({
          status: 'error',
          progress: (completed + 0) / total,
        });
        // Stop queue on hard failure; retry on next flush / reopen.
        return;
      }
    }

    jobs = await readQueue();
    const nextQueue = jobs.filter((j) => !j.uploaded);
    await writeQueue(nextQueue);

    if (nextQueue.some((j) => j.error)) {
      emit({ status: 'error', progress: completed / Math.max(1, total) });
    } else if (nextQueue.length === 0) {
      emit({ status: 'success', progress: 1 });
    } else {
      emit({ status: 'uploading', progress: completed / Math.max(1, total) });
    }
  } finally {
    processing = false;
  }
}

export async function pendingUploadCount(): Promise<number> {
  const jobs = await readQueue();
  return jobs.filter((j) => !j.uploaded).length;
}
