import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { contactSheets, imageMagick, findFont } from "../acceptance/report/sheets.mjs";
import { renderReport } from "../acceptance/report/html.mjs";

const required = process.env.COURTSIDE_SHEET_RENDERER === "required";
const skip = !required && !(imageMagick() && findFont());
const config = { personas: {}, baseUrl: "https://example.org" };
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

function makeRun(root, name, { defect = false, fullDefect = false } = {}) {
  const run = join(root, name);
  const shots = join(run, "shots", "desktop-chrome", "memberA", "overview");
  mkdirSync(shots, { recursive: true });
  const shot = join(shots, "01-account.png");
  for (const [path, height, changed] of [[shot, 160, defect], [shot.replace(/\.png$/, "-full.png"), 240, fullDefect]]) {
    const [binary, args] = imageMagick().convert(["-size", `320x${height}`, "xc:white", "-font", findFont(),
      "-pointsize", "18", "-fill", "black", "-annotate", "+20+35", "Profile", ...(changed ? ["-fill", "red", "-draw", `point 280,${height - 20}`] : []), path]);
    execFileSync(binary, args);
  }
  return { run, sheets: contactSheets(run) };
}

function reviewRun(entry, verdict = "clean") {
  const finding = { key: "manual:profile", severity: "minor", kind: "Profile", title: "Profile clipping", where: [] };
  const review = { sheets: Object.fromEntries(entry.sheets.names.map((name) => [name, { verdict, by: "reviewer" }])),
    ...(verdict === "clean" ? {} : { manual: [finding], assessments: { "manual:profile": {
      assessment: "product-defect", reason: "The profile clips its last row.", followUp: "Correct the profile spacing."
    } } }) };
  writeFileSync(join(entry.run, "review.json"), JSON.stringify(review));
  renderReport(entry.run, config, { harnessCommit: "fixture", sheets: entry.sheets });
}

function report(entry, previous) {
  return renderReport(entry.run, config, { harnessCommit: "fixture", sheets: entry.sheets, previous: previous.run });
}

test("given a previously clean native sheet, when the same evidence is reported again, then its verdict is inherited without changing human review", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-"));
  try {
    const previous = makeRun(root, "previous");
    reviewRun(previous);
    const current = makeRun(root, "current");
    // when
    const result = report(current, previous);
    // then
    assert.equal(result.status, "final", "unchanged previously clean evidence needs no repeated reading");
    assert.equal(existsSync(join(current.run, "review.json")), false, "generated verdicts do not overwrite human review");
    const resolved = json(join(current.run, "sheet-review.json"));
    assert.deepEqual(resolved.verdicts[current.sheets.names[0]], { verdict: "clean", by: "inherited:previous" });
    const html = readFileSync(join(current.run, "report", "index.html"), "utf8");
    assert.match(html, /1 inherited/);
    assert.match(html, /inherited:previous/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given an inherited clean sheet, when the next candidate has the same evidence, then the clean verdict remains traceable across candidates", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-chain-"));
  try {
    const first = makeRun(root, "first"); reviewRun(first);
    const second = makeRun(root, "second"); report(second, first);
    const third = makeRun(root, "third");
    // when
    const result = report(third, second);
    // then
    assert.equal(result.status, "final");
    assert.deepEqual(json(join(third.run, "sheet-review.json")).verdicts[third.sheets.names[0]], { verdict: "clean", by: "inherited:second" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const [kind, change] of [["viewport", { defect: true }], ["full-page", { fullDefect: true }]]) {
  test(`given a previously clean sheet with a one-pixel ${kind} defect, when reported, then a fresh reading remains required`, { skip }, () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-defect-"));
    try {
      const previous = makeRun(root, "previous"); reviewRun(previous);
      const current = makeRun(root, "current", change);
      // when
      const result = report(current, previous);
      // then
      assert.equal(result.status, "draft", "a defect outside run data cannot inherit a clean verdict");
      assert.equal(Object.keys(json(join(current.run, "sheet-review.json")).verdicts).length, 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("given a previous sheet carrying a finding, when its pixels are unchanged, then it remains in the manual queue", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-finding-"));
  try {
    const previous = makeRun(root, "previous"); reviewRun(previous, ["manual:profile"]);
    const current = makeRun(root, "current");
    // when
    const result = report(current, previous);
    // then
    assert.equal(result.status, "draft");
    assert.deepEqual(json(join(current.run, "review-batches.json")).batches.flat(), current.sheets.names);
    assert.deepEqual(json(join(current.run, "sheet-review.json")).verdicts, {});
  } finally { rmSync(root, { recursive: true, force: true }); }
});
