/** Public OAuth / Firebase IDs only. Never put client secrets here. */

export const BUNDLE_ID = 'com.mattruiz.stagecover';
export const APP_SCHEME = 'stagecover';

/** From GoogleService-Info.plist (Firebase project ios999-42e36). */
export const GOOGLE_IOS_CLIENT_ID =
  '266949663759-svhu4seqs0k4kagkjnfdd93i0i501ddg.apps.googleusercontent.com';

/**
 * Prefer the Web client ID shown in Firebase → Authentication → Google
 * (“Web SDK configuration”). Until you paste that, iOS client is used as fallback
 * (same Cloud project — required for Firebase token audience).
 */
export const GOOGLE_WEB_CLIENT_ID =
  '266949663759-svhu4seqs0k4kagkjnfdd93i0i501ddg.apps.googleusercontent.com';

/** Reversed iOS client id — URL scheme Google redirects into the app. */
export const GOOGLE_IOS_URL_SCHEME =
  'com.googleusercontent.apps.266949663759-svhu4seqs0k4kagkjnfdd93i0i501ddg';

export const MODERATOR_GMAIL = 'matthewxruiz@gmail.com';

export const DAILY_QUOTA_SECONDS = 60 * 60;
export const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

export const DRIVE_FOLDER_NAME = 'Stage Cover Recordings';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** From GoogleService-Info.plist (Firebase project ios999-42e36). */
export const firebaseConfig = {
  apiKey: 'AIzaSyCqCrmvvlUZygX_7NRRJCzKjt-09Q-53CY',
  authDomain: 'ios999-42e36.firebaseapp.com',
  projectId: 'ios999-42e36',
  storageBucket: 'ios999-42e36.firebasestorage.app',
  messagingSenderId: '266949663759',
  appId: '1:266949663759:ios:bc0f770699f62343b5977a',
};
