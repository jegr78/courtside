import { afterEach, expect, it, vi } from "vitest";
import { ApiError, api } from "./client";
import { loginWithCapacity } from "./loginWithCapacity";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function busy(seconds = 1) {
  return Object.assign(new ApiError(429, {
    type: "urn:courtside:error:login-rate-limited", title: "Busy", status: 429
  }), { retryAfterSeconds: seconds });
}

it("given short typed admission pressure, when signing in, then wait the server duration before a successful retry", async () => {
  // given
  vi.useFakeTimers();
  const login = vi.spyOn(api, "login").mockRejectedValueOnce(busy()).mockResolvedValueOnce();
  const waiting = vi.fn();
  const controller = new AbortController();
  // when
  const result = loginWithCapacity("doe.jane", "secret", controller.signal, waiting);
  await vi.advanceTimersByTimeAsync(999);
  // then
  expect(login).toHaveBeenCalledTimes(1);
  expect(waiting).toHaveBeenCalledWith(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toBeUndefined();
  expect(login).toHaveBeenCalledTimes(2);
  expect(login).toHaveBeenLastCalledWith("doe.jane", "secret", expect.any(AbortSignal), 2);
});

it("given repeated admission pressure, when the attempt budget ends, then stop without an endless retry", async () => {
  // given
  vi.useFakeTimers();
  const refusal = busy();
  const login = vi.spyOn(api, "login").mockRejectedValue(refusal);
  // when
  const result = loginWithCapacity("doe.jane", "secret", new AbortController().signal, vi.fn())
    .catch((failure: unknown) => failure);
  await vi.runAllTimersAsync();
  // then
  expect(await result).toBe(refusal);
  expect(login).toHaveBeenCalledTimes(5);
  expect(vi.getTimerCount()).toBe(0);
});

it("given repeated longer admission waits, when the total waiting budget is consumed, then do not schedule another wait", async () => {
  // given
  vi.useFakeTimers();
  const refusal = busy(5);
  const login = vi.spyOn(api, "login").mockRejectedValue(refusal);
  // when
  const result = loginWithCapacity("doe.jane", "secret", new AbortController().signal, vi.fn())
    .catch((failure: unknown) => failure);
  await vi.runAllTimersAsync();
  // then
  expect(await result).toBe(refusal);
  expect(login).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it("given capacity refusals after CSRF repair, when retrying, then count real credential requests toward the five-request budget", async () => {
  // given
  vi.useFakeTimers();
  const refusal = Object.assign(busy(), { requestAttempts: 2 });
  const lastRefusal = Object.assign(busy(), { requestAttempts: 1 });
  const login = vi.spyOn(api, "login").mockRejectedValue(lastRefusal).mockRejectedValueOnce(refusal).mockRejectedValueOnce(refusal)
    .mockRejectedValueOnce(lastRefusal);
  // when
  const result = loginWithCapacity("doe.jane", "secret", new AbortController().signal, vi.fn())
    .catch((failure: unknown) => failure);
  await vi.runAllTimersAsync();
  // then
  expect(await result).toBe(lastRefusal);
  expect(login).toHaveBeenCalledTimes(3);
  expect(login.mock.calls.map((call) => call[3])).toEqual([2, 2, 1]);
  expect(vi.getTimerCount()).toBe(0);
});

it("given wrong credentials or an unrelated refusal, when signing in, then never retry that failure", async () => {
  // given
  const failures = [
    new ApiError(401, { type: "urn:courtside:error:unauthenticated", title: "Not authenticated", status: 401 }),
    Object.assign(new ApiError(429, { type: "urn:courtside:error:password-verification-rate-limited", title: "Busy", status: 429 }), { retryAfterSeconds: 1 }),
    Object.assign(new ApiError(503), { retryAfterSeconds: 1 }),
    new TypeError("Network request failed")
  ];
  const login = vi.spyOn(api, "login");
  // when / then
  for (const failure of failures) {
    login.mockReset().mockRejectedValue(failure);
    await expect(loginWithCapacity("doe.jane", "secret", new AbortController().signal, vi.fn()))
      .rejects.toBe(failure);
    expect(login).toHaveBeenCalledTimes(1);
  }
});

it("given missing invalid or excessive retry advice, when signing in, then report the refusal without automatic waiting", async () => {
  // given
  const login = vi.spyOn(api, "login");
  // when / then
  for (const seconds of [undefined, 0, -1, 0.5, NaN, Infinity, 6]) {
    const refusal = Object.assign(busy(), { retryAfterSeconds: seconds });
    login.mockReset().mockRejectedValue(refusal);
    await expect(loginWithCapacity("doe.jane", "secret", new AbortController().signal, vi.fn()))
      .rejects.toBe(refusal);
    expect(login).toHaveBeenCalledTimes(1);
  }
});

it("given a waiting sign-in, when leaving cancels it, then remove the timer and never submit credentials again", async () => {
  // given
  vi.useFakeTimers();
  const login = vi.spyOn(api, "login").mockRejectedValue(busy());
  const controller = new AbortController();
  const result = loginWithCapacity("doe.jane", "secret", controller.signal, vi.fn());
  const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  // when
  controller.abort();
  await vi.runAllTimersAsync();
  // then
  await assertion;
  expect(login).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("given an already cancelled sign-in, when starting it, then do not send any credentials", async () => {
  // given
  const login = vi.spyOn(api, "login");
  const controller = new AbortController();
  controller.abort();
  // when / then
  await expect(loginWithCapacity("doe.jane", "secret", controller.signal, vi.fn()))
    .rejects.toMatchObject({ name: "AbortError" });
  expect(login).not.toHaveBeenCalled();
});

it("given an unresponsive login request, when the overall deadline expires, then cancel the request and release the waiting member", async () => {
  // given
  vi.useFakeTimers();
  const login = vi.spyOn(api, "login").mockImplementation(() => new Promise(() => {}));
  const assertion = expect(loginWithCapacity("doe.jane", "secret", new AbortController().signal, vi.fn()))
    .rejects.toMatchObject({ name: "TimeoutError" });
  // when
  await vi.advanceTimersByTimeAsync(15_000);
  // then
  await assertion;
  expect(login).toHaveBeenCalledTimes(1);
  expect(login.mock.calls[0][2]?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
}, 1000);
