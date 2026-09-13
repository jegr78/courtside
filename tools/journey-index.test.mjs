import { strict as assert } from "node:assert";
import test from "node:test";
import { deviceAndLanguage, journeyIndex, journeyRows } from "./journey-index.mjs";

const REPORT = {
  suites: [{
    specs: [],
    suites: [{
      specs: [{
        file: "journeys/with-a-phone/book-a-singles-court.spec.ts",
        title: "given two members who want a singles match",
        tests: [{
          projectName: "journey-iphone-en",
          status: "expected",
          results: [{
            duration: 24300,
            attachments: [
              { name: "journey-1", contentType: "video/webm", path: "/runs/one/journey-1.webm" },
              { name: "trace", contentType: "application/zip", path: "/runs/one/trace.zip" },
              { name: "screenshot", contentType: "image/png", path: "/runs/one/finished.png" }
            ]
          }]
        }]
      }]
    }]
  }]
};

test("given a journey project, when its name is read, then it names the device and the language", () => {
  // when / then
  assert.deepEqual(deviceAndLanguage("journey-android-de"), { device: "Android", language: "German" });
  assert.deepEqual(deviceAndLanguage("journey-desktop-en"), { device: "Desktop", language: "English" });
});

test("given a name no journey project carries, when it is read, then it is refused rather than guessed", () => {
  // when / then
  assert.throws(() => deviceAndLanguage("chromium"), /Not a journey project/);
  assert.throws(() => deviceAndLanguage("journey-desktop"), /Not a journey project/);
  assert.throws(() => deviceAndLanguage("journey-laptop-de"), /Not a journey project/);
});

test("given a report of one run, when the rows are read, then each carries what it walked and how long it took", () => {
  // when
  const [row] = journeyRows(REPORT);

  // then
  assert.equal(row.journey, "with-a-phone/book-a-singles-court");
  assert.equal(row.device, "iPhone");
  assert.equal(row.language, "English");
  assert.equal(row.outcome, "expected");
  assert.equal(row.seconds, 24.3);
});

test("given a report, when the index is written, then every artefact the run left is linked from it", () => {
  // when
  const index = journeyIndex(REPORT, "2026-09-13T20:00:00Z");

  // then
  assert.match(index, /1 runs, 0 of them not as expected/);
  assert.match(index, /\[video\]\(\/runs\/one\/journey-1\.webm\)/);
  assert.match(index, /\[trace\]\(\/runs\/one\/trace\.zip\)/);
  assert.match(index, /\[screenshot\]\(\/runs\/one\/finished\.png\)/);
});

test("given a run that did not do what was expected, when the index is written, then it is counted as such", () => {
  // given
  const red = structuredClone(REPORT);
  red.suites[0].suites[0].specs[0].tests[0].status = "unexpected";

  // when
  const index = journeyIndex(red, "2026-09-13T20:00:00Z");

  // then
  assert.match(index, /1 runs, 1 of them not as expected/);
  assert.match(index, /\| unexpected \|/);
});

test("given a run that left nothing behind, when the index is written, then the row says so instead of linking nothing", () => {
  // given
  const bare = structuredClone(REPORT);
  bare.suites[0].suites[0].specs[0].tests[0].results[0].attachments = [];

  // when
  const index = journeyIndex(bare, "2026-09-13T20:00:00Z");

  // then
  assert.match(index, /\| — \| — \| — \|/);
});
