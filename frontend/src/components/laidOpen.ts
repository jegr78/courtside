import { useSyncExternalStore } from "react";

const laidOpenFrom = window.matchMedia("(width >= 1024px)");

function subscribe(changed: () => void) {
  laidOpenFrom.addEventListener("change", changed);
  return () => laidOpenFrom.removeEventListener("change", changed);
}

/** Whether the administration navigation is laid open as a sidebar rather than folded into a menu. */
export function useLaidOpen() {
  return useSyncExternalStore(subscribe, () => laidOpenFrom.matches, () => false);
}
