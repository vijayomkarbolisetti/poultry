import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { describeApiError as describeApiErrorMessage, resolveApiBaseUrl } from "./apiConfig";

export { PRODUCTION_API_URL } from "./apiConfig";

/**
 * Resolve API base URL for emulator vs physical device / release APK.
 * Release builds use public HTTPS (EXPO_PUBLIC_API_URL / app.json extra) — never
 * emulator loopback or private LAN http:// URLs from .env (Android blocks cleartext).
 */
function resolveApiUrl(): string {
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  return resolveApiBaseUrl({
    envUrl: process.env.EXPO_PUBLIC_API_URL,
    lanUrl: process.env.EXPO_PUBLIC_LAN_API_URL,
    extraUrl: extra?.apiUrl,
    platform: Platform.OS,
    isDevice: Constants.isDevice !== false,
    isDev: typeof __DEV__ === "boolean" ? __DEV__ : false,
    allowPrivateApi: (process.env.EXPO_PUBLIC_ALLOW_PRIVATE_API ?? "").trim() === "1",
  });
}

export const API_URL = resolveApiUrl();

const ACCESS_KEY = "pvt_access_token";
const REFRESH_KEY = "pvt_refresh_token";
const OWNER_KEY = "pvt_owner_account_id";

/** In-memory cache — SecureStore is slow; avoid reading it on every API call. */
let memAccess: string | null | undefined;
let memRefresh: string | null | undefined;
let memOwner: string | null | undefined;
let hydratePromise: Promise<void> | null = null;

async function hydrateTokens(): Promise<void> {
  if (memAccess !== undefined && memRefresh !== undefined && memOwner !== undefined) return;
  if (!hydratePromise) {
    hydratePromise = (async () => {
      const [access, refresh, owner] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY),
        SecureStore.getItemAsync(REFRESH_KEY),
        SecureStore.getItemAsync(OWNER_KEY),
      ]);
      if (memAccess === undefined) memAccess = access;
      if (memRefresh === undefined) memRefresh = refresh;
      if (memOwner === undefined) memOwner = owner;
    })().finally(() => {
      hydratePromise = null;
    });
  }
  await hydratePromise;
}

export const tokenStore = {
  hydrate: hydrateTokens,
  getAccess: async () => {
    await hydrateTokens();
    return memAccess ?? null;
  },
  getRefresh: async () => {
    await hydrateTokens();
    return memRefresh ?? null;
  },
  getOwnerId: async () => {
    await hydrateTokens();
    return memOwner ?? null;
  },
  setTokens: async (access: string, refresh: string) => {
    memAccess = access;
    memRefresh = refresh;
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, access),
      SecureStore.setItemAsync(REFRESH_KEY, refresh),
    ]);
  },
  setOwnerId: async (ownerId: string | null) => {
    memOwner = ownerId;
    if (ownerId) await SecureStore.setItemAsync(OWNER_KEY, ownerId);
    else await SecureStore.deleteItemAsync(OWNER_KEY);
  },
  clear: async () => {
    memAccess = null;
    memRefresh = null;
    memOwner = null;
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
      SecureStore.deleteItemAsync(OWNER_KEY),
    ]);
  },
};

/** Turn an API failure into a user-facing message (free-tier hosting can be slow to wake up). */
export function describeApiError(e: unknown, action: string): string {
  return describeApiErrorMessage(e, action);
}

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  // Warm requests should be fast; cold hosts (free tier) may still need longer.
  timeout: 30000,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
});

// Access tokens expire after 2h. On a 401, swap the refresh token for a new pair once and retry.
// Refresh tokens rotate, so concurrent 401s must share a single refresh call.
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = await tokenStore.getRefresh();
  if (!refresh) return null;
  try {
    const { data } = await axios.post<{ access_token: string; refresh_token: string }>(
      `${API_URL}/api/v1/auth/refresh`,
      { refresh_token: refresh },
      { timeout: 30000 },
    );
    await tokenStore.setTokens(data.access_token, data.refresh_token);
    return data.access_token;
  } catch {
    await tokenStore.clear();
    return null;
  }
}

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
  const isAuthCall = /^\/auth\/(login|register-owner|refresh|logout)/.test(original?.url ?? "");
  if (error.response?.status !== 401 || !original || original._retried || isAuthCall) {
    throw error;
  }
  original._retried = true;
  refreshing ??= refreshAccessToken().finally(() => {
    refreshing = null;
  });
  const access = await refreshing;
  if (!access) throw error;
  original.headers.Authorization = `Bearer ${access}`;
  return api(original);
});

api.interceptors.request.use(async (config) => {
  // Fast path: memory already hydrated — no SecureStore awaits.
  if (memAccess === undefined || memOwner === undefined) {
    await hydrateTokens();
  }
  if (memAccess) config.headers.Authorization = `Bearer ${memAccess}`;
  if (memOwner) config.headers["X-Owner-Account-Id"] = memOwner;
  return config;
});
