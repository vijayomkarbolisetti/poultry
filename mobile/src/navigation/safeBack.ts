import { Href, router } from "expo-router";

/**
 * Tabs + hidden screens often have no stack history, so `router.back()` throws
 * "The action 'GO_BACK' was not handled by any navigator."
 */
export function safeBack(fallback: Href = "/(app)/home") {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallback);
}
