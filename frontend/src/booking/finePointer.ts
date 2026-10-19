import { useSyncExternalStore } from "react";

// No media query names a mouse, so any fine pointer stands in for the one that can drag across slots.
const finePointer = window.matchMedia("(any-pointer: fine)");

function subscribe(changed: () => void) {
  finePointer.addEventListener("change", changed);
  return () => finePointer.removeEventListener("change", changed);
}

export function useFinePointer(): boolean {
  return useSyncExternalStore(subscribe, () => finePointer.matches);
}
