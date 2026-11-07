import { useEffect, useRef } from "react";

export type SearchContext = {
  ownerAccountId?: string | null;
  shedId?: string | null;
  userId?: string | null;
};

/** Stable key for farm/owner/shed/user-scoped search state. */
export function buildSearchContextKey(context: SearchContext): string {
  return [context.ownerAccountId ?? "", context.shedId ?? "", context.userId ?? ""].join(":");
}

/** True when the search context key changed. */
export function shouldResetSearchContext(
  previousKey: string | null,
  nextKey: string | null,
): boolean {
  return previousKey !== nextKey;
}

/**
 * Resets screen-scoped search state when its parent context changes
 * (farm switch/logout, or a different shed).
 *
 * Fires only when `contextKey` changes after the first render, so a screen's
 * initial empty state is preserved and there is a single reset path.
 */
export function useResetSearchOnContextChange(
  contextKey: string | null,
  reset: () => void,
): void {
  const previousKey = useRef(contextKey);
  const resetRef = useRef(reset);

  useEffect(() => {
    resetRef.current = reset;
  });

  useEffect(() => {
    if (!shouldResetSearchContext(previousKey.current, contextKey)) return;
    previousKey.current = contextKey;
    resetRef.current();
  }, [contextKey]);
}
