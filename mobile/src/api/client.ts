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

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  timeout: 20000,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use(async (config) => {
  const access = await tokenStore.getAccess();
  const ownerId = await tokenStore.getOwnerId();
  if (access) config.headers.Authorization = `Bearer ${access}`;
  if (ownerId) config.headers["X-Owner-Account-Id"] = ownerId;
  return config;
});
