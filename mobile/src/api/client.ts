import axios from "axios";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/** Android emulator reaches host machine via 10.0.2.2; device needs LAN IP. */
const defaultHost =
  Platform.OS === "android" ? "http://10.0.2.2:8001" : "http://localhost:8001";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? defaultHost;

const ACCESS_KEY = "pvt_access_token";
const REFRESH_KEY = "pvt_refresh_token";
const OWNER_KEY = "pvt_owner_account_id";

export const tokenStore = {
  getAccess: () => SecureStore.getItemAsync(ACCESS_KEY),
  getRefresh: () => SecureStore.getItemAsync(REFRESH_KEY),
  getOwnerId: () => SecureStore.getItemAsync(OWNER_KEY),
  setTokens: async (access: string, refresh: string) => {
    await SecureStore.setItemAsync(ACCESS_KEY, access);
    await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  },
  setOwnerId: async (ownerId: string | null) => {
    if (ownerId) await SecureStore.setItemAsync(OWNER_KEY, ownerId);
    else await SecureStore.deleteItemAsync(OWNER_KEY);
  },
  clear: async () => {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
    await SecureStore.deleteItemAsync(OWNER_KEY);
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
  // Render free instances sleep when idle (~30-50s cold start) and hash passwords slowly on 0.1 CPU.
  timeout: 90000,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use(async (config) => {
  const access = await tokenStore.getAccess();
  const ownerId = await tokenStore.getOwnerId();
  if (access) config.headers.Authorization = `Bearer ${access}`;
  if (ownerId) config.headers["X-Owner-Account-Id"] = ownerId;
  return config;
});
