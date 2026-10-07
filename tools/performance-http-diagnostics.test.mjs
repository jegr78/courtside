import assert from "node:assert/strict";
import { test } from "node:test";
import { checkOutcomes, outcomeSignature, unexpectedOutcome } from "../performance/http-diagnostics.js";

function response(status, body) {
  return {
    status,
    json(selector) {
      if (body === undefined) throw new Error("cannot parse json due to an error at offset 0");
      return selector === undefined ? body : body[selector];
    }
  };
}

test("given a refused booking, when describing the outcome, then problem type, violation codes and trace are named", () => {
  // given
  const refused = response(422, {
    type: "urn:courtside:error:booking-rules-violated",
    violations: [{ code: "booking.rule.advanceWindow.exceeded" }],
    traceId: "0af7651916cd43dd8448eb211c80319c"
  });
  // when
  const description = unexpectedOutcome("POST /api/bookings", refused);
  // then
  assert.equal(description, "POST /api/bookings returned unexpected status 422 urn:courtside:error:booking-rules-violated"
    + " violations=booking.rule.advanceWindow.exceeded traceId=0af7651916cd43dd8448eb211c80319c");
});

test("given a response without a JSON body, when describing the outcome, then the unreadable body is stated", () => {
  // when
  const description = unexpectedOutcome("GET /api/courts", response(502));
  // then
  assert.equal(description, "GET /api/courts returned unexpected status 502 without a readable problem body");
});

test("given two refusals of one request with different problem types, when signing them, then they stay distinguishable", () => {
  // when
  const unavailable = outcomeSignature("POST /api/bookings", response(409, { type: "urn:courtside:error:court-unavailable" }));
  const modified = outcomeSignature("POST /api/bookings", response(409, { type: "urn:courtside:error:concurrent-modification" }));
  // then
  assert.notEqual(unavailable, modified, "a second kind of failure on the same request must still be reported");
  assert.equal(outcomeSignature("GET /api/courts", response(502)), "GET /api/courts 502 -");
});

test("given nested groups with checks, when retaining check outcomes, then each check keeps its group path and counts", () => {
  // given
  const root = {
    name: "", path: "", checks: [],
    groups: [{
      name: "public shell", path: "::public shell",
      checks: [{ name: "GET / status 200", path: "::public shell::GET / status 200", passes: 118, fails: 2 }],
      groups: []
    }]
  };
  // when
  const outcomes = checkOutcomes(root);
  // then
  assert.deepEqual(outcomes, [{ path: "::public shell::GET / status 200", passes: 118, fails: 2 }]);
});
