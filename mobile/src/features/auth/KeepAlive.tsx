import { useEffect } from "react";
import { AppState } from "react-native";

import { warmApi } from "../../api/auth";

/** Ping /health while the app is open so free-tier hosts stay warm. */
export function KeepAlive() {
  useEffect(() => {
    warmApi();
    const id = setInterval(() => {
      if (AppState.currentState === "active") warmApi();
    }, 4 * 60 * 1000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") warmApi();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);
  return null;
}
