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
  unlimited: boolean;
};

function emptyQuota(now = Date.now(), unlimited = false): QuotaState {
  return {
    secondsUsed: 0,
    secondsLeft: unlimited ? Number.MAX_SAFE_INTEGER : DAILY_QUOTA_SECONDS,
    windowStartedAt: now,
    unlimited,
  };
}

function normalizeWindow(
  secondsUsed: number,
  windowStartedAt: number,
  unlimited: boolean,
  now = Date.now(),
): QuotaState {
  if (unlimited) {
    return {
      secondsUsed: 0,
      secondsLeft: Number.MAX_SAFE_INTEGER,
      windowStartedAt: windowStartedAt || now,
      unlimited: true,
    };
  }
  if (!windowStartedAt || now - windowStartedAt >= QUOTA_WINDOW_MS) {
    return emptyQuota(now, false);
  }
  const used = Math.max(0, Math.min(DAILY_QUOTA_SECONDS, Math.floor(secondsUsed)));
  return {
    secondsUsed: used,
    secondsLeft: Math.max(0, DAILY_QUOTA_SECONDS - used),
    windowStartedAt,
    unlimited: false,
  };
}

function readUnlimited(data: Record<string, unknown> | undefined): boolean {
  return Boolean(data?.unlimitedLifetime);
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
      unlimitedLifetime: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return emptyQuota(now, false);
  }
  const data = snap.data();
  return normalizeWindow(
    Number(data.secondsUsed ?? 0),
    Number(data.windowStartedAt ?? 0),
    readUnlimited(data),
  );
}

export async function fetchQuota(uid: string): Promise<QuotaState> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) {
    return emptyQuota();
  }
  const data = snap.data();
  return normalizeWindow(
    Number(data.secondsUsed ?? 0),
    Number(data.windowStartedAt ?? 0),
    readUnlimited(data),
  );
}

/** Deduct recording seconds from the rolling 24h window. Unlimited skips deduct. */
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
        unlimitedLifetime: false,
        updatedAt: serverTimestamp(),
      });
      return {
        secondsUsed: used,
        secondsLeft: DAILY_QUOTA_SECONDS - used,
        windowStartedAt: now,
        unlimited: false,
      };
    }
    const data = snap.data();
    if (readUnlimited(data)) {
      return normalizeWindow(0, Number(data.windowStartedAt ?? now), true, now);
    }
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
      unlimited: false,
    };
  });
}

/** Mark lifetime unlimited on the user doc (wire App Store IAP before shipping paid). */
export async function unlockUnlimitedLifetime(uid: string): Promise<QuotaState> {
  const ref = doc(db, 'users', uid);
  await setDoc(
    ref,
    {
      unlimitedLifetime: true,
      unlimitedPurchasedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return fetchQuota(uid);
}

export function formatSecondsLeft(seconds: number, unlimited = false): string {
  if (unlimited) {
    return 'Unlimited';
  }
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
