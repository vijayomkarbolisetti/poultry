import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  EMPTY_TRANSIENT_SEARCH,
  normalizeTransientQuery,
  reduceTransientSearch,
} from "./transientSearch";

/**
 * Temporary debounced search state for list screens.
 *
 * Clears the visible query, debounced value, and pending timer whenever the
 * owning screen loses focus. A generation guard prevents a timer that already
 * fired from applying after a blur/clear.
 */
export function useTransientSearchQuery(debounceMs = 350) {
  const [state, dispatch] = useReducer(reduceTransientSearch, EMPTY_TRANSIENT_SEARCH);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);

  const cancelTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const clearSearch = useCallback(() => {
    generation.current += 1;
    cancelTimer();
    dispatch({ type: "clear" });
  }, [cancelTimer]);

  const setQuery = useCallback(
    (value: string) => {
      generation.current += 1;
      const requestGeneration = generation.current;
      cancelTimer();
      dispatch({ type: "query", value });
      if (!normalizeTransientQuery(value)) return;
      timer.current = setTimeout(() => {
        if (generation.current !== requestGeneration) return;
        dispatch({ type: "debounced", value });
      }, debounceMs);
    },
    [cancelTimer, debounceMs],
  );

  useFocusEffect(
    useCallback(() => {
      return () => {
        clearSearch();
      };
    }, [clearSearch]),
  );

  useEffect(() => {
    return () => {
      generation.current += 1;
      cancelTimer();
    };
  }, [cancelTimer]);

  return {
    query: state.query,
    debouncedQuery: state.debouncedQuery,
    setQuery,
    clearSearch,
  };
}
