import { expect, it, vi } from "vitest";
import { abortable } from "./abortable";

it("given an operation without a signal, when awaiting it, then preserve its result", async () => {
  // given
  const operation = vi.fn().mockResolvedValue("ready");
  // when / then
  await expect(abortable(operation)).resolves.toBe("ready");
  expect(operation).toHaveBeenCalledOnce();
});

it("given an already aborted operation, when starting it, then never invoke the operation", () => {
  // given
  const controller = new AbortController();
  controller.abort();
  const operation = vi.fn();
  // when / then
  expect(() => abortable(operation, controller.signal)).toThrow();
  expect(operation).not.toHaveBeenCalled();
});

it("given a completed or failed operation, when settling it, then remove its abort listener", async () => {
  // given
  const controller = new AbortController();
  const removed = vi.spyOn(controller.signal, "removeEventListener");
  const failure = new Error("Failed");
  // when / then
  await expect(abortable(() => Promise.resolve("ready"), controller.signal)).resolves.toBe("ready");
  await expect(abortable(() => Promise.reject(failure), controller.signal)).rejects.toBe(failure);
  await expect(abortable(() => { throw failure; }, controller.signal)).rejects.toBe(failure);
  expect(removed).toHaveBeenCalledTimes(3);
  removed.mockRestore();
});

it("given a pending operation with an explicit failure reason, when cancelled, then preserve the error and remove its listener", async () => {
  // given
  const controller = new AbortController();
  const removed = vi.spyOn(controller.signal, "removeEventListener");
  const failure = new Error("Cancelled");
  const result = abortable(() => new Promise(() => {}), controller.signal);
  // when
  controller.abort(failure);
  // then
  await expect(result).rejects.toBe(failure);
  expect(removed).toHaveBeenCalledOnce();
  removed.mockRestore();
});

it("given a cancellation reason that is not an error, when cancelled, then report an AbortError without leaking that value", async () => {
  // given
  const controller = new AbortController();
  const result = abortable(() => new Promise(() => {}), controller.signal);
  // when
  controller.abort("private cancellation detail");
  // then
  await expect(result).rejects.toMatchObject({ name: "AbortError", message: "Sign-in cancelled" });
});
