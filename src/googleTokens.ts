import * as SecureStore from 'expo-secure-store';
import {
  DRIVE_SCOPE,
  GOOGLE_WEB_CLIENT_ID,
} from './config';

const ACCESS_KEY = 'sc_google_access_token';
const REFRESH_KEY = 'sc_google_refresh_token';
const EXPIRY_KEY = 'sc_google_access_expiry';

export type GoogleTokenBundle = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: number;
};

export async function saveGoogleTokens(bundle: GoogleTokenBundle): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, bundle.accessToken);
  await SecureStore.setItemAsync(EXPIRY_KEY, String(bundle.expiresAt));
  if (bundle.refreshToken) {
    await SecureStore.setItemAsync(REFRESH_KEY, bundle.refreshToken);
  }
}

export async function clearGoogleTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  await SecureStore.deleteItemAsync(EXPIRY_KEY);
}

async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenBundle | null> {
  const body = new URLSearchParams({
    client_id: GOOGLE_WEB_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    return null;
  }
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };
  if (!json.access_token) {
    return null;
  }
  const bundle: GoogleTokenBundle = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  await saveGoogleTokens(bundle);
  return bundle;
}

export async function getValidGoogleAccessToken(): Promise<string | null> {
  const access = await SecureStore.getItemAsync(ACCESS_KEY);
  const expiryRaw = await SecureStore.getItemAsync(EXPIRY_KEY);
  const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
  const expiresAt = expiryRaw ? Number(expiryRaw) : 0;
  if (access && expiresAt > Date.now() + 60_000) {
    return access;
  }
  if (refresh) {
    const refreshed = await refreshAccessToken(refresh);
    return refreshed?.accessToken ?? null;
  }
  return access;
}

export const GOOGLE_AUTH_SCOPES = [
  'openid',
  'profile',
  'email',
  DRIVE_SCOPE,
] as const;
