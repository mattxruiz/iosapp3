import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { DAILY_QUOTA_SECONDS, QUOTA_WINDOW_MS } from './config';
import { db } from './firebase';

export type QuotaState = {
  secondsUsed: number;
  secondsLeft: number;
  windowStartedAt: number;
};

function emptyQuota(now = Date.now()): QuotaState {
  return {
    secondsUsed: 0,
    secondsLeft: DAILY_QUOTA_SECONDS,
    windowStartedAt: now,
  };
}

function normalizeWindow(
  secondsUsed: number,
  windowStartedAt: number,
  now = Date.now(),
): QuotaState {
  if (!windowStartedAt || now - windowStartedAt >= QUOTA_WINDOW_MS) {
    return emptyQuota(now);
  }
  const used = Math.max(0, Math.min(DAILY_QUOTA_SECONDS, Math.floor(secondsUsed)));
  return {
    secondsUsed: used,
    secondsLeft: Math.max(0, DAILY_QUOTA_SECONDS - used),
    windowStartedAt,
  };
}

export async function ensureUserProfile(uid: string, email: string | null, displayName: string | null) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const now = Date.now();
    await setDoc(ref, {
      email: email ?? null,
      displayName: displayName ?? null,
      secondsUsed: 0,
      windowStartedAt: now,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return emptyQuota(now);
  }
  const data = snap.data();
  return normalizeWindow(Number(data.secondsUsed ?? 0), Number(data.windowStartedAt ?? 0));
}

export async function fetchQuota(uid: string): Promise<QuotaState> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) {
    return emptyQuota();
  }
  const data = snap.data();
  return normalizeWindow(Number(data.secondsUsed ?? 0), Number(data.windowStartedAt ?? 0));
}

/** Deduct recording seconds from the rolling 24h window. Returns updated quota. */
export async function consumeQuotaSeconds(uid: string, seconds: number): Promise<QuotaState> {
  const add = Math.max(0, Math.floor(seconds));
  if (add <= 0) {
    return fetchQuota(uid);
  }
  const ref = doc(db, 'users', uid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    if (!snap.exists()) {
      const used = Math.min(DAILY_QUOTA_SECONDS, add);
      tx.set(ref, {
        secondsUsed: used,
        windowStartedAt: now,
        updatedAt: serverTimestamp(),
      });
      return {
        secondsUsed: used,
        secondsLeft: DAILY_QUOTA_SECONDS - used,
        windowStartedAt: now,
      };
    }
    const data = snap.data();
    let windowStartedAt = Number(data.windowStartedAt ?? 0);
    let secondsUsed = Number(data.secondsUsed ?? 0);
    if (!windowStartedAt || now - windowStartedAt >= QUOTA_WINDOW_MS) {
      windowStartedAt = now;
      secondsUsed = 0;
    }
    secondsUsed = Math.min(DAILY_QUOTA_SECONDS, secondsUsed + add);
    tx.update(ref, {
      secondsUsed,
      windowStartedAt,
      updatedAt: serverTimestamp(),
    });
    return {
      secondsUsed,
      secondsLeft: Math.max(0, DAILY_QUOTA_SECONDS - secondsUsed),
      windowStartedAt,
    };
  });
}

export function formatSecondsLeft(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  if (m > 0) {
    return `${m}m ${rem}s`;
  }
  return `${rem}s`;
}
