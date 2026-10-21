import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../i18n";
import de from "../locales/de";
import en from "../locales/en";
import { ApiError } from "./client";
import { problemMessage, violationMessage } from "./problem-message";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => {
  vi.unstubAllEnvs();
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

it("given a problem without a type, when resolving it, then the generic message is shown", () => {
  // given
  const error = new ApiError(400, { title: "Untyped", status: 400 } as unknown as ConstructorParameters<typeof ApiError>[1]);

  // when / then
  expect(problemMessage(error, i18n.t)).toBe(i18n.t("error.generic"));
});

it("given an ended session, when a request is refused as unauthenticated, then the member reads that they are signed out", () => {
  // given
  const error = new ApiError(401, { type: "urn:courtside:error:unauthenticated", title: "Not authenticated", status: 401 });

  // when / then
  expect(problemMessage(error, i18n.t), "a refused request is not a wrong password").toBe("You are no longer signed in. Sign in again.");
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

it("given a refusal the user can correct, when it carries a trace, then the reason stands without a support reference", () => {
  // given
  const error = new ApiError(409, { type: "urn:courtside:error:membership-periods-overlap", title: "Conflict", status: 409,
    traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" });

  // when
  const message = problemMessage(error, i18n.t);

  // then
  expect(message, "an expected refusal reads like its reason alone").toBe(i18n.t("error.type.membership-periods-overlap"));
});

it("given a coded rule violation with a trace, when resolving it, then only the violation is shown", () => {
  // given
  const error = new ApiError(422, { type: "urn:courtside:error:booking-rules-violated", title: "Unprocessable", status: 422,
    traceId: "0123456789abcdef0123456789abcdef",
    violations: [{ code: "booking.rule.advanceWindow.exceeded", params: { days: 14 } }] });

  // when
  const message = problemMessage(error, i18n.t);

  // then
  expect(message, "a violation the member can act on carries no reference").not.toContain("0123456789abcdef0123456789abcdef");
});

const pageDefectTypes = (bundle: Record<string, string>) => Object.entries(bundle)
  .filter(([key, message]) => key.startsWith("error.type.") && message === "$t(error.pageDefect)")
  .map(([key]) => key.slice("error.type.".length)).sort();

it("given both bundles, when the page-defect family is read, then each language marks the same types and the request-shape refusals are among them", () => {
  // when
  const inDe = pageDefectTypes(de);
  const inEn = pageDefectTypes(en);

  // then
  expect(inDe, "both languages mark the same types as page defects").toEqual(inEn);
  expect(inEn, "a request the page built wrongly is a page defect").toEqual(expect.arrayContaining(
    ["malformed-request-body", "parameter-type-mismatch", "method-not-supported", "unsupported-media-type",
      "idempotency-key-reused", "request-rejected", "access-denied"]));
});

it.each(pageDefectTypes(en))("given a %s refusal with a trace, when resolving it, then support can still be quoted the reference", (slug) => {
  // given
  const error = new ApiError(400, { type: `urn:courtside:error:${slug}`, title: "Refused", status: 400,
    traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" });

  // when
  const message = problemMessage(error, i18n.t);

  // then
  expect(message, "a page defect names what the page did").toContain(i18n.t("error.pageDefect"));
  expect(message, "a page defect keeps its reference").toContain("0123456789abcdef0123456789abcdef/0123456789abcdef");
});

it("given a refusal of a type this client does not know, when it carries a trace, then support can still be quoted the reference", () => {
  // given
  const error = new ApiError(409, { type: "urn:courtside:error:not-in-this-client", title: "Conflict", status: 409,
    traceId: "0123456789abcdef0123456789abcdef" });

  // when
  const message = problemMessage(error, i18n.t);

  // then
  expect(message, "an unexplained refusal keeps its reference").toContain("0123456789abcdef0123456789abcdef");
});

it("given a violation code this client does not carry, when it carries a trace, then support can still be quoted the reference", () => {
  // given
  const error = new ApiError(422, { type: "urn:courtside:error:booking-rules-violated", title: "Unprocessable", status: 422,
    traceId: "0123456789abcdef0123456789abcdef", violations: [{ code: "booking.rule.introducedLater", params: {} }] });

  // when
  const message = problemMessage(error, i18n.t);

  // then
  expect(message, "an untranslated violation keeps its reference").toContain("0123456789abcdef0123456789abcdef");
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

it("given a file whose column count moved, when resolving the refusal, then the board reads both counts", () => {
  // given
  const error = new ApiError(400, {
    type: "urn:courtside:error:import-snapshot-unreadable",
    title: "Snapshot unreadable",
    status: 400,
    violations: [{ code: "import.snapshot.columns.countChanged", params: { expected: 4, found: 3 } }]
  });

  // when
  const message = problemMessage(error, i18n.t);

  // then
  expect(message).toBe(i18n.t("import.snapshot.columns.countChanged", { expected: 4, found: 3 }));
  expect(message, "both counts reach the board").toMatch(/3.*4/);
});

it.each([
  ["import.source.columnMode.changeUnconfirmed", { from: "HEADER", to: "POSITION" }],
  ["import.source.positions.outOfRange", { position: 5, columnCount: 4 }],
  ["import.source.positions.incomplete", {}],
  ["import.source.positions.ambiguous", {}],
  ["import.source.positions.unexpected", {}],
  ["import.source.columns.unexpected", {}],
  ["import.source.columnCount.outOfRange", { maxColumns: 200 }]
])("given the refused source code %s, when resolving it, then the board reads its own sentence", (code, params) => {
  // given
  const error = new ApiError(400, {
    type: "urn:courtside:error:import-source-invalid",
    title: "Invalid import source",
    status: 400,
    violations: [{ code, params }]
  });

  // when
  const message = problemMessage(error, i18n.t);

  // then
  expect(i18n.exists(code), `${code} has an English text`).toBe(true);
  expect(message).toBe(i18n.t(code, params));
});
