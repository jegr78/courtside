import assert from "node:assert/strict";
import { test } from "node:test";
import {
  consoleFailure, consoleWarning, failedRequest, journeyFailure, refusal, refusedResponse
} from "../performance/browser-diagnostics.js";

const target = "https://proxy";

function request(method, url, errorText) {
  return { method: () => method, url: () => url, failure: () => errorText === undefined ? null : { errorText } };
}

function response(status, body, method = "POST", url = `${target}/api/bookings`) {
  return {
    status: () => status,
    url: () => url,
    request: () => ({ method: () => method }),
    json: () => ({
      then: (resolve, reject) => body instanceof Error ? reject(body) : resolve(body)
    })
  };
}

test("given an aborted booking refresh, when describing the failed request, then method, path and error are named", () => {
  // when
  const description = failedRequest(request("GET", `${target}/api/allocations?date=2026-10-12`, "net::ERR_ABORTED"), target);
  // then
  assert.equal(description, "request failed: GET /api/allocations net::ERR_ABORTED",
    "a failed request must name what was requested and why it failed");
});

test("given an empty sign-in or cancellation response, when describing the failed request, then it is not a failure", () => {
  // when / then
  assert.equal(failedRequest(request("POST", `${target}/api/session`, "net::ERR_ABORTED"), target), undefined);
  assert.equal(failedRequest(request("DELETE", `${target}/api/bookings/b1`, "net::ERR_ABORTED"), target), undefined);
});

test("given a failed request without failure details, when describing it, then the absence is stated", () => {
  // when
  const description = failedRequest(request("GET", `${target}/api/courts`), target);
  // then
  assert.equal(description, "request failed: GET /api/courts without an error text");
});

test("given a console error, when describing it, then its text is kept and bounded", () => {
  // given
  const message = { type: () => "error", text: () => `Failed to load resource ${"x".repeat(600)}` };
  // when
  const description = consoleFailure(message);
  // then
  assert.match(description, /^console error: Failed to load resource x+/);
  assert.ok(description.length <= 330, "an unbounded console message must not flood the run log");
});

test("given a console warning, when describing it, then it is not a failure", () => {
  // when / then
  assert.equal(consoleFailure({ type: () => "warning", text: () => "deprecated" }), undefined);
});

test("given a console warning, when describing it as a warning, then its bounded text is named", () => {
  // given
  const message = { type: () => "warning", text: () => `booking dialog refresh: status 503 ${"x".repeat(600)}` };
  // when
  const description = consoleWarning(message);
  // then
  assert.match(description, /^console warning: booking dialog refresh: status 503 x+/);
  assert.ok(description.length <= 330, "an unbounded console message must not flood the run log");
});

test("given a console error, when describing it as a warning, then it is left to the failure path", () => {
  // when / then
  assert.equal(consoleWarning({ type: () => "error", text: () => "boom" }), undefined,
    "an error is counted by the failure path and must not be written twice");
});

test("given a refused booking, when describing the response, then status, problem type, violation codes and trace are named", async () => {
  // given
  const refused = response(422, {
    type: "urn:courtside:error:booking-rules-violated",
    violations: [{ code: "booking.rule.startsInPast", params: {} }, { code: "booking.rule.maxOpenBookings.exceeded" }],
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736"
  });
  // when
  const description = await refusal("booking", refused);
  // then
  assert.equal(description, "booking returned status 422 urn:courtside:error:booking-rules-violated"
    + " violations=booking.rule.startsInPast,booking.rule.maxOpenBookings.exceeded traceId=4bf92f3577b34da6a3ce929d0e0e4736");
});

test("given a validation failure, when describing the response, then the rejected fields are named", async () => {
  // given
  const refused = response(400, {
    type: "urn:courtside:error:validation-failed",
    fieldErrors: [{ field: "cardId", code: "validation.NotNull" }]
  });
  // when
  const description = await refusal("booking", refused);
  // then
  assert.equal(description, "booking returned status 400 urn:courtside:error:validation-failed fields=cardId:validation.NotNull");
});

test("given a response without a problem body, when describing it, then the unreadable body is stated", async () => {
  // when
  const description = await refusal("booking", response(502, new SyntaxError("Unexpected end of JSON input")));
  // then
  assert.equal(description, "booking returned status 502 without a readable problem body");
});

test("given a client error during the journey, when describing the response, then method, path and status are named", () => {
  // when / then
  assert.equal(refusedResponse(response(429, {}, "POST", `${target}/api/session?retry=1`), target),
    "response 429: POST /api/session");
  assert.equal(refusedResponse(response(204, {}), target), undefined);
});

test("given a failed step, when describing the journey failure, then the step, elapsed time and page are named", () => {
  // when
  const description = journeyFailure("submit booking", new Error("timeout"), 4210, `${target}/?date=2026-10-07`, target);
  // then
  assert.equal(description, "Browser journey failed at submit booking after 4210 ms on / : Error: timeout");
});
