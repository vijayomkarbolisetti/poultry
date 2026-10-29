/**
 * Imperative toast API — light, theme-aligned bottom pills.
 * ToastHost in root layout subscribes; screens call toast.success / toast.error / etc.
 */

export type ToastTone = "success" | "error" | "warning" | "info";

export type ToastPayload = {
  id: number;
  message: string;
  tone: ToastTone;
  durationMs: number;
};

type Listener = (payload: ToastPayload | null) => void;

const DEFAULT_DURATION_MS: Record<ToastTone, number> = {
  success: 2500,
  error: 3200,
  warning: 3000,
  info: 2800,
};

/** Ignore identical message+tone repeats within this window (accidental double-fire). */
const DEDUPE_MS = 1500;

let seq = 0;
let current: ToastPayload | null = null;
let lastShown: { message: string; tone: ToastTone; at: number } | null = null;
const listeners = new Set<Listener>();

function emit(payload: ToastPayload | null) {
  current = payload;
  listeners.forEach((fn) => fn(payload));
}

function show(message: string, tone: ToastTone, durationMs?: number) {
  const trimmed = message.trim();
  if (!trimmed) return;

  const now = Date.now();
  if (
    lastShown &&
    lastShown.message === trimmed &&
    lastShown.tone === tone &&
    now - lastShown.at < DEDUPE_MS
  ) {
    return;
  }
  lastShown = { message: trimmed, tone, at: now };

  emit({
    id: ++seq,
    message: trimmed,
    tone,
    durationMs: Math.max(1200, durationMs ?? DEFAULT_DURATION_MS[tone]),
  });
}

export const toast = {
  success: (message: string, durationMs?: number) => show(message, "success", durationMs),
  error: (message: string, durationMs?: number) => show(message, "error", durationMs),
  warning: (message: string, durationMs?: number) => show(message, "warning", durationMs),
  info: (message: string, durationMs?: number) => show(message, "info", durationMs),
  hide: () => emit(null),
  getCurrent: () => current,
  subscribe: (listener: Listener) => {
    listeners.add(listener);
    listener(current);
    return () => {
      listeners.delete(listener);
    };
  },
};
