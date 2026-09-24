import { beforeEach, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { ApiError } from "./client";
import { problemMessage, violationMessage } from "./problem-message";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

it("given a coded violation, when resolving the problem, then its i18n key is translated", () => {
  // given
  const error = new ApiError(400, {
    type: "urn:courtside:error:booking-rules-violated",
    title: "Booking not allowed",
    status: 422,
    violations: [{ code: "booking.rule.advanceWindow.exceeded", params: { maxDays: 14 } }]
  });

  // when
  const message = problemMessage(error, i18n.t);

  // then
  expect(message).toBe(i18n.t("booking.rule.advanceWindow.exceeded", { maxDays: 14 }));
});

it("given a violation code this client does not carry, when resolving it, then it is told apart from a generic failure", () => {
  // when
  const message = violationMessage("booking.rule.introducedLater", {}, i18n.t);

  // then
  expect(message, "an untranslated code is not the generic failure").not.toBe(i18n.t("error.generic"));
  expect(message).toContain(i18n.t("error.unknownViolation"));
  expect(message, "development names the missing key").toContain("[booking.rule.introducedLater]");
});

it("given a production build, when a violation code is untranslated, then the page names no key", () => {
  // given
  vi.stubEnv("DEV", false);

  // when
  const message = violationMessage("booking.rule.introducedLater", {}, i18n.t);

  // then
  expect(message).toBe(i18n.t("error.unknownViolation"));
  vi.unstubAllEnvs();
});

it("given a problem type a board can act on, when it carries no violation, then its own message is shown", () => {
  // given
  const error = new ApiError(409, { type: "urn:courtside:error:last-administrator", title: "Last administrator", status: 409 });

  // when
  const message = problemMessage(error, i18n.t);

  // then
  expect(message).toBe("That would leave no enabled administrator. Appoint another one first.");
});

it("given a concurrent booking loss, when resolving it, then the stable type is actionable", () => {
  // given
  const error = new ApiError(409, { type: "urn:courtside:error:court-unavailable", title: "Court unavailable", status: 409 });

  // when / then
  expect(problemMessage(error, i18n.t)).toBe("Someone else just booked this court. Choose another time.");
});

it("given a problem type this client does not know, when resolving it, then the generic message is shown", () => {
  // given
  const error = new ApiError(409, { type: "urn:courtside:error:introduced-later", title: "Later", status: 409 });

  // when / then
  expect(problemMessage(error, i18n.t)).toBe(i18n.t("error.generic"));
});

it("given an unknown failure, when resolving it, then no technical detail is exposed", () => {
  // when / then
  expect(problemMessage(new Error("Database connection failed"), i18n.t)).toBe(i18n.t("error.generic"));
});

it("given a problem with a trace reference, when resolving it, then the member can quote it", () => {
  // given
  const traceId = "0123456789abcdef0123456789abcdef";
  const spanId = "0123456789abcdef";
  const error = new ApiError(500, { type: "urn:courtside:error:internal-error", title: "Internal error", status: 500, traceId, spanId });

  // when
  const message = problemMessage(error, i18n.t);

  // then
  expect(message).toContain(i18n.t("error.type.internal-error"));
  expect(message).toContain(`${traceId}/${spanId}`);
});

it("given a refused upload, when resolving it, then the board reads which formats are read rather than the generic message", async () => {
  // given
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
