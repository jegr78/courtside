import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { attemptStep, failureCode, failureReason } from "./failure-reason.mjs";

test("given an error, when describing it, then its name and message are kept", () => {
  // when
  const reason = failureReason(new TypeError("Cannot read properties of undefined"));
  // then
  assert.deepEqual(reason, { name: "TypeError", message: "Cannot read properties of undefined" },
    "an incomplete step must say which error stopped it");
});

test("given a long message, when describing it, then the message is bounded", () => {
  // when
  const reason = failureReason(new Error(`docker failed: ${"x".repeat(1000)}`));
  // then
  assert.ok(reason.message.length <= 201, "process output in a message must not flood the private evidence");
  assert.match(reason.message, /^docker failed: x+…$/);
});

test("given a thrown value that is not an error, when describing it, then its type is named", () => {
  // when / then
  assert.deepEqual(failureReason("refused"), { name: "string", message: "refused" },
    "a thrown string still says what was thrown");
  assert.deepEqual(failureReason(undefined), { name: "undefined", message: "" },
    "a missing value says so instead of failing itself");
});

test("given a step that throws, when attempting it, then the step yields nothing and its reason is kept under its name", async () => {
  // given
  const failures = {};
  // when
  const value = await attemptStep(failures, "gatewayTelemetry", async () => { throw new SyntaxError("Unexpected token < in JSON"); });
  // then
  assert.equal(value, undefined, "a failed step yields no value, as the empty catch did before");
  assert.deepEqual(failures, { gatewayTelemetry: { name: "SyntaxError", message: "Unexpected token < in JSON" } },
    "the step that failed is named with its reason");
});

test("given a step that succeeds, when attempting it, then its value is returned and no failure is recorded", async () => {
  // given
  const failures = {};
  // when
  const value = await attemptStep(failures, "scannerSummary", async () => ({ checks: [] }));
  // then
  assert.deepEqual(value, { checks: [] });
  assert.deepEqual(failures, {}, "a step that worked leaves no reason behind");
});

test("given a module's own failure code, when coding a failure for shared evidence, then the code is kept", () => {
  // when / then
  assert.equal(failureCode(new Error("mail-raw-truncated")), "mail-raw-truncated",
    "a code the module threw itself names the step without carrying data");
});

test("given a failure whose text may carry private data, when coding it for shared evidence, then only its name is kept", () => {
  // when / then
  assert.equal(failureCode(new Error("password=private-token To: jane@example.org")), "Error",
    "free text from a command or a mail must not leave the private record");
  assert.equal(failureCode(new SyntaxError("Unexpected token j in JSON")), "SyntaxError");
});

test("given an error from another realm, when describing it, then it is still read as an error", () => {
  // given
  const foreign = runInNewContext('new RangeError("outside this realm")');
  // when / then
  assert.deepEqual(failureReason(foreign), { name: "RangeError", message: "outside this realm" },
    "an error thrown in a sandbox or worker keeps its name and message");
  assert.equal(failureCode(runInNewContext('new Error("mail-raw-truncated")')), "mail-raw-truncated");
});
