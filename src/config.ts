/** Public OAuth / Firebase IDs only. Never put client secrets here. */

export const BUNDLE_ID = 'com.mattruiz.stagecover';
export const APP_SCHEME = 'blacrec';

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

/** Free rolling window: 30 minutes every 24 hours. */
export const DAILY_QUOTA_SECONDS = 30 * 60;
export const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Lifetime unlimited unlock price (App Store IAP plugs in later). */
export const UNLIMITED_PRICE_LABEL = '$1.99';
export const UNLIMITED_PRODUCT_ID = 'blacrec_unlimited_lifetime';

/**
 * Contact / support link shown in Account → Contact support.
 * Replace when you have the final URL — copyable in the popup.
 */
export const SUPPORT_CONTACT_LINK = 'https://support.link.pending';

export const DRIVE_FOLDER_NAME = 'BlacRec Recordings';
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
