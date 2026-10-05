export function abortable<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation();
  signal.throwIfAborted();
  let cancel: () => void;
  return new Promise<T>((resolve, reject) => {
    cancel = () => reject(abortReason(signal));
    signal.addEventListener("abort", cancel, { once: true });
    operation().then(resolve, reject);
  }).finally(() => { signal.removeEventListener("abort", cancel); });
}

export function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error || reason instanceof DOMException
    ? reason : new DOMException("Sign-in cancelled", "AbortError");
}
