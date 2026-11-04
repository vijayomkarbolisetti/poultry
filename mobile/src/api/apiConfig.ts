/**
 * Pure API URL + error-message helpers (testable without React Native runtime).
 */

export const PRODUCTION_API_URL = "https://3.6.160.64.sslip.io";

const LOOPBACK_RE = /:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i;

export function isLoopbackUrl(url: string): boolean {
  return LOOPBACK_RE.test(url);
}

export function isEmulatorOnlyUrl(url: string): boolean {
  return /10\.0\.2\.2/i.test(url) || isLoopbackUrl(url);
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Resolve the API origin (no `/api/v1` suffix).
 * Release builds never fall back to emulator loopback addresses.
 */
export function resolveApiBaseUrl(input: {
  envUrl?: string | null;
  lanUrl?: string | null;
  extraUrl?: string | null;
  platform: "ios" | "android" | "web" | string;
  /** True for physical devices and most release installs. */
  isDevice: boolean;
  /** Expo/Metro `__DEV__` — false in release APKs. */
  isDev: boolean;
}): string {
  const envUrl = (input.envUrl ?? "").trim();
  const lanUrl = (input.lanUrl ?? "").trim();
  const extraUrl = (input.extraUrl ?? "").trim();
  const onEmulator = input.platform === "android" && input.isDevice === false;

  const toEmulatorHost = (url: string) =>
    url.replace("://localhost", "://10.0.2.2").replace("://127.0.0.1", "://10.0.2.2");

  // Production / release APK: prefer configured public HTTPS URL; never use 10.0.2.2.
  if (!input.isDev) {
    const releaseUrl = envUrl || extraUrl;
    if (releaseUrl && !isEmulatorOnlyUrl(releaseUrl)) {
      return stripTrailingSlash(releaseUrl);
    }
    return PRODUCTION_API_URL;
  }

  // Dev builds only reach production when EXPO_PUBLIC_API_URL says so explicitly;
  // app.json `extra.apiUrl` is the release default and is ignored here.
  const configured = envUrl;

  if (onEmulator) {
    if (configured) {
      if (isLoopbackUrl(configured)) return stripTrailingSlash(configured);
      if (isEmulatorOnlyUrl(configured)) return stripTrailingSlash(configured);
      return stripTrailingSlash(toEmulatorHost(configured));
    }
    return "http://10.0.2.2:8001";
  }

  if (lanUrl) return stripTrailingSlash(lanUrl);
  if (configured && !isEmulatorOnlyUrl(configured)) return stripTrailingSlash(configured);
  // Physical device in dev without a LAN URL: use localhost (works with
  // `adb reverse tcp:8001 tcp:8001`) rather than silently hitting production data.
  return stripTrailingSlash(configured || "http://localhost:8001");
}

/** Turn an API failure into a user-facing message. */
export function describeApiError(e: unknown, action: string): string {
  const err = e as {
    code?: string;
    message?: string;
    response?: { status?: number; data?: { detail?: unknown } };
  };
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

  if (err.code === "ECONNABORTED") {
    return `The server is taking too long (it may be waking up). Please wait a minute and try again.`;
  }

  const noResponse = !err.response;
  const networkCode =
    err.code === "ERR_NETWORK" ||
    err.code === "ENOTFOUND" ||
    err.code === "ECONNREFUSED" ||
    err.code === "ERR_CONNECTION_REFUSED";
  if (noResponse && (networkCode || /network error/i.test(err.message ?? ""))) {
    return `Could not reach the server to ${action}. Check your internet connection, or try again when the API is online.`;
  }

  if (status === 401) {
    return `Could not ${action}: email or password is incorrect.`;
  }
  if (status === 403) {
    return `Could not ${action}: you do not have permission.`;
  }
  if (status === 404) {
    return `Could not ${action}: this feature is not available on the server yet. Ask an admin to update the API.`;
  }
  if (status === 409) {
    return `Could not ${action}: that conflicts with existing data.`;
  }
  if (status === 422) {
    return `Could not ${action}. Please check the details you entered.`;
  }
  if (status && status >= 500) {
    return `Could not ${action}: server error (${status}). Please try again.`;
  }
  if (status) {
    return `Could not ${action} (error ${status}). Please try again.`;
  }
  if (Array.isArray(detail)) {
    return `Could not ${action}. Please check the details you entered.`;
  }
  return `Could not ${action}. Please try again.`;
}
