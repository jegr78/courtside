import { afterEach, expect, it, vi } from "vitest";
import { idempotencyKey } from "./idempotency";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => { vi.unstubAllGlobals(); });

it("given a secure context, when a key is needed, then the platform generator is used", () => {
  const randomUUID = vi.fn(() => "11111111-1111-4111-8111-111111111111");
  vi.stubGlobal("crypto", { ...crypto, randomUUID });

  expect(idempotencyKey()).toBe("11111111-1111-4111-8111-111111111111");
  expect(randomUUID).toHaveBeenCalled();
});

it("given plain HTTP on a club's own network, when a key is needed, then one is still produced", () => {
  // crypto.randomUUID exists only in a secure context; getRandomValues does not have that bound.
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });

  const keys = new Set(Array.from({ length: 100 }, () => idempotencyKey()));

  expect([...keys].every((key) => uuid.test(key))).toBe(true);
  expect(keys.size).toBe(100);
});
