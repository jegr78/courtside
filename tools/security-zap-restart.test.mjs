import assert from "node:assert/strict";
import test from "node:test";
import { ZapScanStalled, scanWithOneRestart } from "./security-environment.mjs";

function scanner(outcomes) {
  const events = [];
  return {
    events,
    options: {
      label: "MEMBER",
      prepare: async () => { events.push("prepare"); },
      scan: async () => {
        events.push("scan");
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
      discard: async () => { events.push("discard"); },
      report: (line) => events.push(`report: ${line}`)
    }
  };
}

test("given a scan that stalls once, when it runs, then a fresh container answers and the restart is reported", async () => {
  // given
  const { events, options } = scanner([new ZapScanStalled("no result"), { code: 0 }]);

  // when
  const result = await scanWithOneRestart(options);

  // then
  assert.deepEqual(result, { code: 0 }, "the second scan's result is returned");
  assert.deepEqual(events.filter((event) => !event.startsWith("report")),
    ["prepare", "scan", "discard", "prepare", "scan"], "the stalled container is discarded before a new one starts");
  assert.equal(events.filter((event) => event.startsWith("report: ZAP MEMBER")).length, 1,
    "the restart is named in the log, not taken silently");
});

test("given a scan that stalls twice, when it runs, then the run fails instead of trying a third time", async () => {
  // given
  const { events, options } = scanner([new ZapScanStalled("first"), new ZapScanStalled("second")]);

  // when / then
  await assert.rejects(scanWithOneRestart(options), ZapScanStalled, "a second stall ends the assessment");
  assert.equal(events.filter((event) => event === "scan").length, 2, "only one restart is allowed");
});

test("given a scan that fails for another reason, when it runs, then it is not restarted", async () => {
  // given
  const { events, options } = scanner([new Error("Owned security process exceeded its duration limit")]);

  // when / then
  await assert.rejects(scanWithOneRestart(options), /duration limit/, "the run's own deadline is not a stall");
  assert.deepEqual(events, ["prepare", "scan"], "nothing is discarded or restarted");
});
