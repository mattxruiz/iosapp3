import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import {
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_IOS_URL_SCHEME,
  GOOGLE_WEB_CLIENT_ID,
} from '../config';
import {
  enqueueDriveUpload,
  hydrateDriveRing,
  processDriveUploadQueue,
  subscribeDriveRing,
  type DriveRingState,
} from '../driveUpload';
import { auth } from '../firebase';
import { clearGoogleTokens, GOOGLE_AUTH_SCOPES, saveGoogleTokens } from '../googleTokens';
import {
  consumeQuotaSeconds,
  ensureUserProfile,
  fetchQuota,
  formatSecondsLeft,
  type QuotaState,
} from '../quota';

WebBrowser.maybeCompleteAuthSession();

type AuthContextValue = {
  user: User | null;
  ready: boolean;
  signingIn: boolean;
  authError: string | null;
  quota: QuotaState | null;
  quotaLabel: string;
  driveRing: DriveRingState;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshQuota: () => Promise<QuotaState | null>;
  recordConsumedSeconds: (seconds: number) => Promise<QuotaState | null>;
  queueRecordingUpload: (localPath: string) => Promise<void>;
  flushUploads: () => Promise<void>;
  clearAuthError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaState | null>(null);
  const [driveRing, setDriveRing] = useState<DriveRingState>({
    status: 'idle',
    progress: 0,
  });

  useEffect(() => {
    void hydrateDriveRing();
    return subscribeDriveRing(setDriveRing);
  }, []);

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID,
    scopes: [...GOOGLE_AUTH_SCOPES],
    selectAccount: true,
    // Must match Google iOS client reversed scheme + app.json CFBundleURLSchemes.
    redirectUri: `${GOOGLE_IOS_URL_SCHEME}:/oauthredirect`,
    extraParams: {
      access_type: 'offline',
      include_granted_scopes: 'true',
    },
  });

  const refreshQuota = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) {
      setQuota(null);
      return null;
    }
    const next = await fetchQuota(current.uid);
    setQuota(next);
    return next;
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (next) => {
      setUser(next);
      setReady(true);
      if (next) {
        void ensureUserProfile(next.uid, next.email, next.displayName)
          .then((q) => setQuota(q))
          .catch(() => {
            void refreshQuota();
          });
        // Resume any unfinished Drive uploads from a previous session.
        void processDriveUploadQueue();
      } else {
        setQuota(null);
      }
    });
    return unsub;
  }, [refreshQuota]);

  useEffect(() => {
    if (!response) {
      return;
    }
    if (response.type !== 'success') {
      if (response.type === 'error') {
        setAuthError(response.error?.message ?? 'Google sign-in failed');
      }
      setSigningIn(false);
      return;
    }

    void (async () => {
      try {
        const idToken = response.authentication?.idToken ?? response.params.id_token;
        const accessToken = response.authentication?.accessToken ?? response.params.access_token;
        if (!idToken) {
          throw new Error('Google did not return an ID token. Check OAuth client setup.');
        }
        const credential = GoogleAuthProvider.credential(idToken, accessToken);
        const result = await signInWithCredential(auth, credential);
        const expiresIn = response.authentication?.expiresIn
          ? Number(response.authentication.expiresIn)
          : 3600;
        if (accessToken) {
          await saveGoogleTokens({
            accessToken,
            refreshToken: response.authentication?.refreshToken ?? null,
            expiresAt: Date.now() + expiresIn * 1000,
          });
        }
        const q = await ensureUserProfile(
          result.user.uid,
          result.user.email,
          result.user.displayName,
        );
        setQuota(q);
        setAuthError(null);
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'Sign-in failed');
      } finally {
        setSigningIn(false);
      }
    })();
  }, [response]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    setSigningIn(true);
    try {
      if (!request) {
        throw new Error('Google sign-in is still preparing. Try again.');
      }
      await promptAsync();
    } catch (error) {
      setSigningIn(false);
      setAuthError(error instanceof Error ? error.message : 'Sign-in failed');
    }
  }, [promptAsync, request]);

  const signOut = useCallback(async () => {
    await clearGoogleTokens();
    await firebaseSignOut(auth);
    setQuota(null);
  }, []);

  const recordConsumedSeconds = useCallback(async (seconds: number) => {
    const current = auth.currentUser;
    if (!current) {
      return null;
    }
    const next = await consumeQuotaSeconds(current.uid, seconds);
    setQuota(next);
    return next;
  }, []);

  const queueRecordingUpload = useCallback(async (localPath: string) => {
    const current = auth.currentUser;
    if (!current) {
      return;
    }
    await enqueueDriveUpload({
      localPath,
      uid: current.uid,
      email: current.email,
    });
    void processDriveUploadQueue();
  }, []);

  const flushUploads = useCallback(async () => {
    await processDriveUploadQueue();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      signingIn,
      authError,
      quota,
      quotaLabel: formatSecondsLeft(quota?.secondsLeft ?? 0),
      driveRing,
      signInWithGoogle,
      signOut,
      refreshQuota,
      recordConsumedSeconds,
      queueRecordingUpload,
      flushUploads,
      clearAuthError: () => setAuthError(null),
    }),
    [
      user,
      ready,
      signingIn,
      authError,
      quota,
      driveRing,
      signInWithGoogle,
      signOut,
      refreshQuota,
      recordConsumedSeconds,
      queueRecordingUpload,
      flushUploads,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
