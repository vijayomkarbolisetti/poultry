/**
 * Run: npx --yes tsx src/api/apiConfig.test.ts
 */
import {
  PRODUCTION_API_URL,
  describeApiError,
  resolveApiBaseUrl,
} from "./apiConfig";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// --- resolveApiBaseUrl ---
assert(
  resolveApiBaseUrl({
    envUrl: "http://10.0.2.2:8003",
    platform: "android",
    isDevice: true,
    isDev: false,
  }) === PRODUCTION_API_URL,
  "release APK must ignore emulator loopback env",
);

assert(
  resolveApiBaseUrl({
    envUrl: "http://192.168.50.75:8002",
    platform: "android",
    isDevice: true,
    isDev: false,
  }) === PRODUCTION_API_URL,
  "release APK must ignore private LAN env (cleartext blocked)",
);

assert(
  resolveApiBaseUrl({
    envUrl: "http://192.168.50.75:8001",
    platform: "android",
    isDevice: true,
    isDev: false,
    allowPrivateApi: true,
  }) === "http://192.168.50.75:8001",
  "local debug APK may use private LAN when explicitly allowed",
);

assert(
  resolveApiBaseUrl({
    envUrl: "https://3.6.160.64.sslip.io",
    platform: "android",
    isDevice: true,
    isDev: false,
  }) === "https://3.6.160.64.sslip.io",
  "release keeps production HTTPS env",
);

assert(
  resolveApiBaseUrl({
    envUrl: null,
    platform: "android",
    isDevice: true,
    isDev: false,
  }) === PRODUCTION_API_URL,
  "release defaults to production when env missing",
);

assert(
  resolveApiBaseUrl({
    envUrl: "http://10.0.2.2:8003",
    platform: "android",
    isDevice: false,
    isDev: true,
  }) === "http://10.0.2.2:8003",
  "dev emulator may use 10.0.2.2",
);

assert(
  resolveApiBaseUrl({
    envUrl: null,
    platform: "android",
    isDevice: true,
    isDev: true,
  }) === PRODUCTION_API_URL,
  "dev physical device must not fall back to 10.0.2.2",
);

// --- describeApiError ---
assert(
  describeApiError(
    { response: { status: 401, data: { detail: "Invalid email or password" } } },
    "sign in",
  ) === "Invalid email or password",
  "401 detail string",
);

assert(
  describeApiError({ response: { status: 401, data: {} } }, "sign in").includes("incorrect"),
  "401 without detail",
);

assert(
  describeApiError({ response: { status: 403, data: {} } }, "load sheds").includes("permission"),
  "403",
);

assert(
  describeApiError({ response: { status: 422, data: { detail: [] } } }, "sign in").includes(
    "check the details",
  ),
  "422",
);

assert(
  describeApiError({ code: "ERR_NETWORK", message: "Network Error" }, "sign in").includes(
    "Could not reach the server",
  ),
  "network error",
);

assert(
  !describeApiError({ code: "ERR_NETWORK", message: "Network Error" }, "sign in").includes(
    "Check your internet connection and try again.",
  ),
  "legacy internet copy retired for network errors",
);

assert(
  describeApiError({ response: { status: 500, data: {} } }, "sign in").includes("server error"),
  "5xx",
);

console.log("apiConfig.test.ts OK");
