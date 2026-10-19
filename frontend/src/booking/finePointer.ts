import { useSyncExternalStore } from "react";

// Dragging across slots in the plan follows a mouse only, so a device with any fine pointer can do it.
const finePointer = window.matchMedia("(any-pointer: fine)");

function subscribe(changed: () => void) {
  finePointer.addEventListener("change", changed);
  return () => finePointer.removeEventListener("change", changed);
}

export function useFinePointer(): boolean {
  return useSyncExternalStore(subscribe, () => finePointer.matches);
}
