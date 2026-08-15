import type { TFunction } from "i18next";
import { expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { problemMessage } from "./problem-message";

const translate = vi.fn((key: string) => `translated:${key}`) as unknown as TFunction;

it("given a coded violation, when resolving the problem, then its i18n key is translated", () => {
  // given
  const error = new ApiError(400, {
    type: "urn:courtside:error:validation-failed",
    title: "Validation failed",
    status: 400,
    violations: [{ code: "booking.rule.advanceWindow.exceeded", params: { maxDays: 14 } }]
  });

  // when
  problemMessage(error, translate);

  // then
  expect(translate).toHaveBeenCalledWith("booking.rule.advanceWindow.exceeded", {
    maxDays: 14,
    defaultValue: "translated:error.generic"
  });
});

it("given an unauthenticated problem, when resolving it, then the stable type is translated", () => {
  // given
  const error = new ApiError(401, {
    type: "urn:courtside:error:unauthenticated",
    title: "Not authenticated",
    status: 401
  });

  // when
  problemMessage(error, translate);

  // then
  expect(translate).toHaveBeenCalledWith("auth.failed");
});

it("given a concurrent booking loss, when resolving it, then the stable type is actionable", () => {
  // given
  const error = new ApiError(409, {
    type: "urn:courtside:error:court-unavailable",
    title: "Court unavailable",
    status: 409
  });

  // when
  problemMessage(error, translate);

  // then
  expect(translate).toHaveBeenCalledWith("booking.courtUnavailable");
});

it("given an unknown failure, when resolving it, then no technical detail is exposed", () => {
  // when
  problemMessage(new Error("Database connection failed"), translate);

  // then
  expect(translate).toHaveBeenCalledWith("error.generic");
});
