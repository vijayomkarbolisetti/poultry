import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Resolve API base URL for emulator vs physical device.
 * - Android emulator: 10.0.2.2 host loopback alias (default port 8001)
 * - EXPO_PUBLIC_API_URL overrides when set (localhost/127.0.0.1 rewritten to 10.0.2.2 on emulator)
 * - Physical device: EXPO_PUBLIC_API_URL (LAN IP) or EXPO_PUBLIC_LAN_API_URL
 */
function resolveApiUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  const lanUrl = process.env.EXPO_PUBLIC_LAN_API_URL;
  const onEmulator = Platform.OS === "android" && Constants.isDevice === false;

  const toEmulatorHost = (url: string) =>
    url.replace("://localhost", "://10.0.2.2").replace("://127.0.0.1", "://10.0.2.2");

  if (onEmulator) {
    if (envUrl) return toEmulatorHost(envUrl);
    return "http://10.0.2.2:8001";
  }
  if (lanUrl) return lanUrl;
  if (envUrl && !envUrl.includes("10.0.2.2")) return envUrl;
  if (Platform.OS === "android") return envUrl ?? "http://10.0.2.2:8001";
  return envUrl ?? "http://localhost:8001";
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
  const err = e as { code?: string; response?: { status?: number; data?: { detail?: unknown } } };
  const status = err.response?.status;
  const detail = err.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const parts = detail
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as { msg?: unknown; loc?: unknown };
        const msg = typeof row.msg === "string" ? row.msg : null;
        if (!msg) return null;
        const loc = Array.isArray(row.loc)
          ? row.loc.filter((p) => p !== "body" && typeof p === "string").join(".")
          : "";
        return loc ? `${loc}: ${msg}` : msg;
      })
      .filter(Boolean);
    if (parts.length) return parts.slice(0, 3).join(" · ");
  }
  if (status === 404) {
    return `Could not ${action}: this feature is not available on the server yet. Ask an admin to update the API.`;
  }
  if (status === 409) {
    return `Could not ${action}: that conflicts with existing data.`;
  }
  if (err.code === "ECONNABORTED") {
    return `The server is taking too long (it may be waking up). Please wait a minute and try again.`;
  }
  if (status && status >= 500) {
    return `Could not ${action}: server error (${status}). Please try again.`;
  }
  if (Array.isArray(detail)) {
    return `Could not ${action}. Please check the details you entered.`;
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
  // Fast path: memory already hydrated — no SecureStore awaits.
  if (memAccess === undefined || memOwner === undefined) {
    await hydrateTokens();
  }
  if (memAccess) config.headers.Authorization = `Bearer ${memAccess}`;
  if (memOwner) config.headers["X-Owner-Account-Id"] = memOwner;
  return config;
});
