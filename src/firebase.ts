import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  type Auth,
  type Persistence,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from './config';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]!;

function createAuth(): Auth {
  try {
    // Web typings omit RN persistence; runtime RN bundle includes it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rnAuth = require('@firebase/auth/dist/rn/index.js') as {
      getReactNativePersistence: (storage: typeof ReactNativeAsyncStorage) => Persistence;
    };
    return initializeAuth(app, {
      persistence: rnAuth.getReactNativePersistence(ReactNativeAsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = createAuth();
export const db = getFirestore(app);
