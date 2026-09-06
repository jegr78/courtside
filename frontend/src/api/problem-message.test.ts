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

it("given a problem with a trace reference, when resolving it, then the member can quote it", () => {
  // given
  const traceId = "0123456789abcdef0123456789abcdef";
  const spanId = "0123456789abcdef";
  const error = new ApiError(500, {
    type: "urn:courtside:error:internal-error",
    title: "Internal error",
    status: 500,
    traceId,
    spanId
  });

  // when
  problemMessage(error, translate);

  // then
  expect(translate).toHaveBeenCalledWith("error.withReference", {
    message: "translated:error.generic",
    reference: `${traceId}/${spanId}`
  });
});

it("given a refused upload, when resolving it, then the board reads which formats are read rather than the generic message", async () => {
  // given
  const i18n = (await import("../i18n")).default;
  await i18n.changeLanguage("de");
  const error = new ApiError(400, {
    type: "urn:courtside:error:import-snapshot-upload-unsupported",
    title: "Snapshot upload unsupported",
    status: 400,
    violations: [{ code: "import.snapshot.extensionUnsupported", params: { extensions: [".csv", ".txt"] } }]
  });

  // when
  const message = problemMessage(error, i18n.t);

  // then
  expect(message).not.toEqual(i18n.t("error.generic"));
  expect(message).toContain(".csv");
});
