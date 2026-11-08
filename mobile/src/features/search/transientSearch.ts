export type TransientSearchState = {
  query: string;
  debouncedQuery: string;
};

export type TransientSearchAction =
  | { type: "query"; value: string }
  | { type: "debounced"; value: string }
  | { type: "clear" };

export const EMPTY_TRANSIENT_SEARCH: TransientSearchState = {
  query: "",
  debouncedQuery: "",
};

export function clearedTransientSearch(): TransientSearchState {
  return { query: "", debouncedQuery: "" };
}

export function normalizeTransientQuery(query: string): string {
  return query.trim();
}

export function isTransientSearchEmpty(query: string): boolean {
  return normalizeTransientQuery(query).length === 0;
}

/**
 * Pure lifecycle state for a temporary, debounced search input.
 * "clear" is the blur/logout/farm-change path; it clears the visible and
 * debounced values atomically so stale results cannot render.
 */
export function reduceTransientSearch(
  state: TransientSearchState,
  action: TransientSearchAction,
): TransientSearchState {
  switch (action.type) {
    case "query":
      return {
        query: action.value,
        // Emptying the visible field clears the debounced query immediately.
        debouncedQuery: isTransientSearchEmpty(action.value) ? "" : state.debouncedQuery,
      };
    case "debounced":
      return { ...state, debouncedQuery: normalizeTransientQuery(action.value) };
    case "clear":
      return clearedTransientSearch();
  }
}
