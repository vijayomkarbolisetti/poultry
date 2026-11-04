import { useSyncExternalStore } from "react";
import { Keyboard, Platform, type EmitterSubscription } from "react-native";

let currentHeight = 0;
const listeners = new Set<() => void>();
let showSub: EmitterSubscription | null = null;
let hideSub: EmitterSubscription | null = null;

function emit() {
  listeners.forEach((l) => l());
}

function ensureKeyboardSubscriptions() {
  if (showSub && hideSub) return;
  const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
  const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
  showSub = Keyboard.addListener(showEvent, (e) => {
    currentHeight = Math.max(0, e.endCoordinates?.height ?? 0);
    emit();
  });
  hideSub = Keyboard.addListener(hideEvent, () => {
    currentHeight = 0;
    emit();
  });
}

function teardownKeyboardSubscriptions() {
  showSub?.remove();
  hideSub?.remove();
  showSub = null;
  hideSub = null;
  currentHeight = 0;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  ensureKeyboardSubscriptions();
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) teardownKeyboardSubscriptions();
  };
}

function getSnapshot() {
  return currentHeight;
}

function getServerSnapshot() {
  return 0;
}

/**
 * Live keyboard height for bottom sheets / modals.
 *
 * Android `softwareKeyboardLayoutMode: "pan"` does not resize transparent Modals,
 * so sheets must lift themselves using this inset (never a hard-coded keyboard height).
 */
export function useKeyboardBottomInset(enabled: boolean): number {
  const height = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return enabled ? height : 0;
}
