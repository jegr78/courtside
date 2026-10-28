let recovery: { codes: string[]; username?: string } | undefined;
const listeners = new Set<() => void>();
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function showRecoveryCodes(codes: string[], username?: string) {
  recovery = { codes, username };
  listeners.forEach((listener) => listener());
}
export function clearRecoveryCodes() {
  recovery = undefined;
  listeners.forEach((listener) => listener());
}

export function currentRecoveryCodes() { return recovery; }
