import { findNodeHandle, ScrollView, TextInput, UIManager } from "react-native";

/**
 * Scroll the currently focused TextInput into view inside a ScrollView.
 * Safe no-op when nothing is focused or measure fails (common on first frame).
 */
export function scrollFocusedInputIntoView(
  scrollRef: React.RefObject<ScrollView | null>,
  extraTop = 24,
): void {
  const scroll = scrollRef.current;
  if (!scroll) return;

  const focused =
    typeof TextInput.State?.currentlyFocusedInput === "function"
      ? TextInput.State.currentlyFocusedInput()
      : null;
  if (!focused) return;

  const scrollNode = findNodeHandle(scroll);
  // New Architecture HostInstance is not in findNodeHandle's public typings yet.
  const inputNode = findNodeHandle(focused as never);
  if (!scrollNode || !inputNode) return;

  requestAnimationFrame(() => {
    UIManager.measureLayout(
      inputNode,
      scrollNode,
      () => {
        /* ignore measure failure */
      },
      (_x, y) => {
        scroll.scrollTo({ y: Math.max(0, y - extraTop), animated: true });
      },
    );
  });
}
