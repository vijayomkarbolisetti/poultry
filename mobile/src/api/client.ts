import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/** Android emulator reaches host machine via 10.0.2.2; device needs LAN IP. */
const defaultHost =
  Platform.OS === "android" ? "http://10.0.2.2:8001" : "http://localhost:8001";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? defaultHost;

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
  const err = e as { code?: string; response?: { status?: number; data?: { detail?: unknown } } };
  const detail = err.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return `Could not ${action}. Please check the details you entered.`;
  if (err.code === "ECONNABORTED") {
    return `The server is taking too long (it may be waking up). Please wait a minute and try again.`;
  }
  if (err.response?.status && err.response.status >= 500) {
    return `Could not ${action}: server error (${err.response.status}). Please try again.`;
  }
  return `Could not ${action}. Check your internet connection and try again.`;
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
  const [access, ownerId] = await Promise.all([tokenStore.getAccess(), tokenStore.getOwnerId()]);
  if (access) config.headers.Authorization = `Bearer ${access}`;
  if (ownerId) config.headers["X-Owner-Account-Id"] = ownerId;
  return config;
});
