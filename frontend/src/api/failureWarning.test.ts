import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { warnAbout } from "./failureWarning";

afterEach(() => vi.restoreAllMocks());

it("given a refused request, when warning about it, then only its status and problem type are named", () => {
  // given
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const refused = new ApiError(503, { type: "urn:courtside:error:database-lock-unavailable", title: "Busy", status: 503 });

  // when
  warnAbout("Session refresh failed", refused);

  // then
  expect(warn).toHaveBeenCalledWith("Session refresh failed: status 503 urn:courtside:error:database-lock-unavailable");
});

it("given a network failure, when warning about it, then its name and message are named", () => {
  // given
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  // when
  warnAbout("CSRF token reissue failed", new TypeError("Failed to fetch"));

  // then
  expect(warn).toHaveBeenCalledWith("CSRF token reissue failed: TypeError: Failed to fetch");
});

it("given something thrown that is no error, when warning about it, then only its kind is named", () => {
  // given
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  // when
  warnAbout("Booking refresh failed", { password: "secret" });

  // then
  expect(warn).toHaveBeenCalledWith("Booking refresh failed: object");
});
