import { ApiError, api } from "./client";
import { abortable, abortReason } from "./abortable";

export async function loginWithCapacity(username: string, password: string,
  signal: AbortSignal, waiting: (seconds: number) => void,
  refresh?: (signal: AbortSignal) => Promise<void>): Promise<void> {
  signal.throwIfAborted();
  const lifetime = new AbortController();
  const cancel = () => lifetime.abort(signal.reason);
  signal.addEventListener("abort", cancel, { once: true });
  const deadline = setTimeout(() => lifetime.abort(new DOMException("Sign-in timed out", "TimeoutError")), 15_000);
  let waited = 0;
  let remainingRequests = 5;
  try {
    for (let attempt = 1; attempt <= 5; attempt++) {
      lifetime.signal.throwIfAborted();
      try {
        await abortable(() => api.login(username, password, lifetime.signal,
          Math.min(2, remainingRequests)), lifetime.signal);
      } catch (failure) {
        lifetime.signal.throwIfAborted();
        if (failure instanceof ApiError) remainingRequests -= failure.requestAttempts;
        const seconds = failure instanceof ApiError ? failure.retryAfterSeconds : undefined;
        if (!(failure instanceof ApiError) || failure.status !== 429
          || failure.problem?.type !== "urn:courtside:error:login-rate-limited"
          || seconds === undefined || !Number.isInteger(seconds) || seconds < 1 || seconds > 5
          || attempt === 5 || remainingRequests < 1 || waited + seconds > 10) throw failure;
        waited += seconds;
        waiting(seconds);
        await wait(seconds * 1000, lifetime.signal);
        continue;
      }
      lifetime.signal.throwIfAborted();
      if (refresh) await abortable(() => refresh(lifetime.signal), lifetime.signal);
      lifetime.signal.throwIfAborted();
      return;
    }
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", cancel);
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
