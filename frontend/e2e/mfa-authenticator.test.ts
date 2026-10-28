import { expect, it } from "vitest";
import { authenticatorCode } from "./mfa-authenticator";

const setupKey = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

it("given the RFC authenticator setup key, when fifty nine seconds have elapsed, then the six digit SHA1 code agrees with the published vector", () => {
  // when / then
  expect(authenticatorCode(setupKey, "1970-01-01T00:00:59Z")).toBe("287082");
});

it("given the next authenticator interval, when the previous code is requested, then it names the previous interval", () => {
  // when / then
  expect(authenticatorCode(setupKey, "1970-01-01T00:01:29Z", -1)).toBe("287082");
});

it("given an invalid authenticator setup key, when a code is requested, then the key is refused", () => {
  // when / then
  expect(() => authenticatorCode("INVALID!", "1970-01-01T00:00:59Z")).toThrow("Invalid authenticator setup key");
});
