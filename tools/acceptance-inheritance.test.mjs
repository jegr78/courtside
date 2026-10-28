import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import childProcess, { execFileSync, spawnSync } from "node:child_process";
import fs, { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { contactSheets, imageMagick, findFont, sheetFrameSignature } from "../acceptance/report/sheets.mjs";
import { findExecutable } from "../acceptance/lib/executable.mjs";
import { renderReport } from "../acceptance/report/html.mjs";

const required = process.env.COURTSIDE_SHEET_RENDERER === "required";
const skip = !required && !(imageMagick() && findFont());
const config = { personas: {}, baseUrl: "https://example.org" };
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

function makeRun(root, name, { defect = false, fullDefect = false, runText = "", defectColor = "red" } = {}) {
  const run = join(root, name);
  const shots = join(run, "shots", "desktop-chrome", "memberA", "overview");
  mkdirSync(shots, { recursive: true });
  const shot = join(shots, "01-account.png");
  for (const [path, height, changed] of [[shot, 160, defect], [shot.replace(/\.png$/, "-full.png"), 240, fullDefect]]) {
    const [binary, args] = imageMagick().convert(["-size", `320x${height}`, "xc:white", "-font", findFont(),
      "-pointsize", "18", "-fill", "black", "-annotate", "+20+35", "Profile", ...(runText ? ["-annotate", "+20+65", runText] : []), ...(changed ? ["-fill", defectColor, "-draw", `point 280,${height - 20}`] : []), path]);
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

function maskedRun(root, name, kind, runText, { defect = false, defectColor = "red", mutate = (record) => record } = {}) {
  const entry = makeRun(root, name, { runText, defect, defectColor });
  const directory = join(entry.run, "shots", "desktop-chrome", "memberA", "overview");
  for (const suffix of ["", "-full"]) {
    const path = join(directory, `01-account${suffix}.png`);
    const bytes = readFileSync(path);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const record = { schemaVersion: 3, safe: true,
      image: { digest: createHash("sha256").update(bytes).digest("hex"), width, height },
      capture: { width, height, devicePixelRatio: 1, userAgent: "fixture", locale: "en-US", timeZone: "UTC", mode: suffix ? "full" : "viewport", scrollX: 0, scrollY: 0 },
      masks: [{ key: `body:0/p:1/text:0/${kind}:0`, kind, style: "18px fixture sans-serif black", rects: [{ x: 20, y: 44, width: 180, height: 26 }] }] };
    writeFileSync(path.replace(/\.png$/, ".comparison.json"), JSON.stringify(mutate(record)));
  }
  entry.sheets = contactSheets(entry.run);
  return entry;
}

for (const [kind, earlier, current] of [
  ["date", "23.10.2026", "24.10.2026"], ["time", "12:34", "12:35"], ["count", "31", "32"],
  ["version", "v0.4.0-rc.1", "v0.4.0-rc.2"], ["generated-name", "abc12345", "def67890"]
]) {
  test(`given changing run-only ${kind} data, when compatible bounded masks compare native pixels, then the previous clean verdict is inherited`, { skip }, () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-mask-"));
    try {
      const previous = maskedRun(root, "previous", kind, earlier); reviewRun(previous);
      const next = maskedRun(root, "current", kind, current);
      const original = readFileSync(join(next.run, "shots", "desktop-chrome", "memberA", "overview", "01-account.png"));
      // when
      const result = report(next, previous);
      // then
      assert.equal(result.status, "final", `only recognized ${kind} pixels changed`);
      assert.deepEqual(readFileSync(join(next.run, "shots", "desktop-chrome", "memberA", "overview", "01-account.png")), original,
        "comparison leaves the original native screenshot unchanged");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

for (const [condition, mutate] of [
  ["legacy mask protocol", (record) => { record.schemaVersion = 2; return record; }],
  ["changed presentation", (record) => { record.masks[0].style = "36px fixture serif red"; return record; }],
  ["moved text", (record) => { record.masks[0].rects[0].x += 3; return record; }],
  ["oversized mask", (record) => { record.masks[0].rects[0].width = 295; return record; }],
  ["out-of-bounds mask", (record) => { record.masks[0].rects[0].x = -1; return record; }],
  ["stale image binding", (record) => { record.image.digest = "0".repeat(64); return record; }],
  ["unstable capture", (record) => { record.safe = false; return record; }],
  ["inconsistent pixel density", (record) => { record.capture.devicePixelRatio = 2; return record; }],
  ["changed browser language", (record) => { record.capture.locale = "de-DE"; return record; }],
  ["changed time zone", (record) => { record.capture.timeZone = "America/New_York"; return record; }],
  ["changed browser", (record) => { record.capture.userAgent = "other fixture"; return record; }]
]) {
  test(`given run-data masking with ${condition}, when native evidence is compared, then the sheet still needs reading`, { skip }, () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-unsafe-mask-"));
    try {
      const previous = maskedRun(root, "previous", "time", "12:34"); reviewRun(previous);
      const next = maskedRun(root, "current", "time", "12:35", { mutate });
      // when
      const result = report(next, previous);
      // then
      assert.equal(result.status, "draft", condition);
      assert.deepEqual(json(join(next.run, "sheet-review.json")).verdicts, {});
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("given run-data masks captured at another pixel density, when native evidence is compared, then the sheet still needs reading", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-density-"));
  const halved = (record) => { record.masks[0].rects = [{ x: 10, y: 22, width: 90, height: 13 }]; return record; };
  const doubled = (record) => Object.assign(halved(record).capture,
    { devicePixelRatio: 2, width: record.capture.width / 2, height: record.capture.height / 2 }) && record;
  try {
    const previous = maskedRun(root, "previous", "time", "12:34", { mutate: halved }); reviewRun(previous);
    const next = maskedRun(root, "current", "time", "12:35", { mutate: doubled });
    // when
    const result = report(next, previous);
    // then
    assert.equal(result.status, "draft", "a verdict read at one pixel density does not transfer to another");
    assert.deepEqual(json(join(next.run, "sheet-review.json")).verdicts, {});
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given valid run-data masks and an unmasked defect, when the report compares native pixels, then it refuses inheritance", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-unmasked-defect-"));
  try {
    const previous = maskedRun(root, "previous", "time", "12:34"); reviewRun(previous);
    const next = maskedRun(root, "current", "time", "12:35", { defect: true });
    // when
    const result = report(next, previous);
    // then
    assert.equal(result.status, "draft");
    assert.deepEqual(json(join(next.run, "sheet-review.json")).verdicts, {});
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const [device, project] of [["desktop", "desktop-chrome"], ["phone", "pixel-7"], ["webkit", "iphone-15-de"], ["firefox", "desktop-firefox"]]) {
  test(`given the real ${device} capture producer output, when run-only values change, then its own PNGs and metadata produce inherited clean sheets`, { skip }, () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-native-producer-"));
    try {
      const runs = ["previous", "current"].map((name) => {
        const run = join(root, name);
        const directory = join(run, "shots", project, "memberA", "overview");
        mkdirSync(directory, { recursive: true });
        for (const suffix of ["", "-full"]) for (const extension of [".png", ".comparison.json"]) {
          const source = new URL(`../acceptance/test/fixtures/comparison/${device}/${name}${suffix}${extension}`, import.meta.url);
          copyFileSync(source, join(directory, `01-account${suffix}${extension}`));
        }
        return { run, sheets: contactSheets(run) };
      });
      reviewRun(runs[0]);
      // when
      const result = report(runs[1], runs[0]);
      // then
      assert.equal(result.status, "final", "the actual capture producer's format works through native pixel comparison and report rendering");
      assert.deepEqual(json(join(runs[1].run, "sheet-review.json")).verdicts[runs[1].sheets.names[0]], { verdict: "clean", by: "inherited:previous" });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("given a changed contact sheet outside its native tiles, when source captures still match, then the altered sheet requires a fresh reading", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-frame-"));
  try {
    const previous = makeRun(root, "previous"); reviewRun(previous);
    const current = makeRun(root, "current");
    const path = join(current.run, "sheets", `${current.sheets.names[0]}.png`);
    const [binary, args] = imageMagick().convert([path, "-fill", "red", "-draw", "point 0,0", path]);
    execFileSync(binary, args);
    // when
    const result = report(current, previous);
    // then
    assert.equal(result.status, "draft", "a changed sheet cannot borrow a verdict from matching native captures");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given a previous human review changed after its audit, when the next report compares it, then stale review evidence cannot supply a verdict", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-stale-review-"));
  try {
    const previous = makeRun(root, "previous"); reviewRun(previous);
    const current = makeRun(root, "current");
    const path = join(previous.run, "review.json");
    const human = json(path); human.sheets[previous.sheets.names[0]].by = "second-reader";
    writeFileSync(path, JSON.stringify(human));
    // when
    const result = report(current, previous);
    // then
    assert.equal(result.status, "draft");
    assert.match(result.changedSheets.inheritanceUnavailable, /stale/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given an old image replaced with the current defective capture, when the saved manifest still describes the clean image, then stale source evidence cannot hide the defect", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-stale-source-"));
  try {
    const previous = makeRun(root, "previous"); reviewRun(previous);
    const current = makeRun(root, "current", { defect: true, defectColor: "black" });
    const image = (entry) => join(entry.run, "shots", "desktop-chrome", "memberA", "overview", "01-account.png");
    copyFileSync(image(current), image(previous));
    // when
    const result = report(current, previous);
    // then
    assert.equal(result.status, "draft", "matching replacement pixels are not the previously reviewed source");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given a run-data sidecar changed after sheet generation, when the next report compares it, then the stale mask binding requires reading", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-stale-mask-"));
  try {
    const previous = maskedRun(root, "previous", "time", "12:34"); reviewRun(previous);
    const current = maskedRun(root, "current", "time", "12:35");
    const path = join(current.run, "shots", "desktop-chrome", "memberA", "overview", "01-account.comparison.json");
    writeFileSync(path, readFileSync(path, "utf8") + "\n");
    // when
    const result = report(current, previous);
    // then
    assert.equal(result.status, "draft", "valid JSON still needs the generator's exact mask binding");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given a previous finding and a fresh manual clean verdict, when the current report renders, then the explicit current reading takes precedence", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-manual-override-"));
  try {
    const previous = makeRun(root, "previous"); reviewRun(previous, ["manual:profile"]);
    const current = makeRun(root, "current"); reviewRun(current);
    const original = readFileSync(join(current.run, "review.json"));
    // when
    const result = report(current, previous);
    // then
    assert.equal(result.status, "final");
    assert.equal(json(join(current.run, "sheet-review.json")).verdicts[current.sheets.names[0]].by, "reviewer");
    assert.deepEqual(readFileSync(join(current.run, "review.json")), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given a copied inherited marker without generated proof, when human review is read, then it cannot claim a fresh or inherited judgment", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-unproven-"));
  try {
    const current = makeRun(root, "current");
    writeFileSync(join(current.run, "review.json"), JSON.stringify({ sheets: { [current.sheets.names[0]]: { verdict: "clean", by: "inherited:unknown" } } }));
    // when / then
    assert.throws(() => report(current, current), /inherited verdicts belong in generated sheet-review/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given clean images but no compatible predecessor manifest, when the report is regenerated, then legacy evidence falls back to manual reading", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-legacy-"));
  try {
    const previous = makeRun(root, "previous"); reviewRun(previous);
    const current = makeRun(root, "current");
    rmSync(join(previous.run, "sheet-evidence.json"));
    // when
    const result = report(current, previous);
    // then
    assert.equal(result.status, "draft");
    assert.deepEqual(json(join(current.run, "review-batches.json")).batches.flat(), current.sheets.names);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given a report compares itself, when it has no manual verdict, then its own pixels cannot create inherited approval", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-self-"));
  try {
    const current = makeRun(root, "current");
    // when
    const result = report(current, current);
    // then
    assert.equal(result.status, "draft");
    assert.deepEqual(json(join(current.run, "sheet-review.json")).verdicts, {});
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given a reviewed screenshot replaced with an external symlink, when identical pixels are available there, then comparison refuses the external source", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-symlink-"));
  try {
    const previous = makeRun(root, "previous"); reviewRun(previous);
    const current = makeRun(root, "current");
    const source = join(previous.run, "shots", "desktop-chrome", "memberA", "overview", "01-account.png");
    const external = join(root, "outside.png");
    copyFileSync(source, external);
    rmSync(source); symlinkSync(external, source);
    // when
    const result = report(current, previous);
    // then
    assert.equal(result.status, "draft", "a matching external image is not the reviewed run's screenshot");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given ten sheets still needing a verdict, when the report schedules reading, then each batch contains at most eight and every sheet appears once", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-batches-"));
  try {
    const run = join(root, "current");
    const directory = join(run, "shots", "desktop-chrome", "memberA", "overview");
    mkdirSync(directory, { recursive: true });
    for (let index = 0; index < 10; index++) for (const suffix of ["", "-full"]) {
      copyFileSync(new URL(`../acceptance/test/fixtures/comparison/desktop/current${suffix}.png`, import.meta.url),
        join(directory, `01-account-${index}${suffix}.png`));
    }
    const sheets = contactSheets(run);
    // when
    const result = renderReport(run, config, { harnessCommit: "fixture", sheets });
    // then
    assert.equal(result.status, "draft");
    const queue = json(join(run, "review-batches.json"));
    assert.equal(queue.batchSize, 8);
    assert.deepEqual(queue.batches.map((batch) => batch.length), [8, 2]);
    assert.deepEqual(queue.batches.flat(), [...sheets.names].sort());
    assert.equal(new Set(queue.batches.flat()).size, sheets.names.length);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given a newly generated sheet frame differs while native captures match, when its current digest is valid, then frame pixels still prevent inheritance", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-renderer-frame-"));
  try {
    const previous = makeRun(root, "previous"); reviewRun(previous);
    const current = makeRun(root, "current");
    const path = join(current.run, "sheets", `${current.sheets.names[0]}.png`);
    const [binary, args] = imageMagick().convert([path, "-fill", "red", "-draw", "point 0,0", path]);
    execFileSync(binary, args);
    const evidencePath = join(current.run, "sheet-evidence.json");
    const evidence = json(evidencePath);
    evidence.sheets[0].imageDigest = createHash("sha256").update(readFileSync(path)).digest("hex");
    evidence.sheets[0].frameSignature = sheetFrameSignature(path, current.sheets.entries[0]);
    writeFileSync(evidencePath, JSON.stringify(evidence));
    // when
    const result = report(current, previous);
    // then
    assert.equal(result.status, "draft", "matching native tiles do not erase a changed label, gap or frame");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const scenario of ["adjacent", "overlay", "welcome", "format", "background", "pseudo", "numeric-label", "date-label", "numeric-heading", "statistics-label", "unscoped-date"]) {
  test(`given real producer output with a static ${scenario} change, when native evidence is compared, then it cannot inherit a clean verdict`, { skip }, () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-static-rejection-"));
    try {
      const runs = ["previous", "current"].map((name) => {
        const run = join(root, name);
        const directory = join(run, "shots", "desktop-chrome", "memberA", "overview");
        mkdirSync(directory, { recursive: true });
        for (const suffix of ["", "-full"]) for (const extension of [".png", ".comparison.json"]) {
          copyFileSync(new URL(`../acceptance/test/fixtures/comparison/rejections/${scenario}/${name}${suffix}${extension}`, import.meta.url),
            join(directory, `01-state${suffix}${extension}`));
        }
        return { run, sheets: contactSheets(run) };
      });
      reviewRun(runs[0]);
      // when
      const result = report(runs[1], runs[0]);
      // then
      assert.equal(result.status, "draft", `the static ${scenario} pixels require reading despite nearby changing run data`);
      assert.deepEqual(json(join(runs[1].run, "sheet-review.json")).verdicts, {});
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

for (const target of ["sheet-evidence", "sheet-review"]) {
  test(`given a legacy ${target} protocol, when the next report compares matching images, then prior evidence needs a fresh reading`, { skip }, () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-legacy-protocol-"));
    try {
      const previous = makeRun(root, "previous"); reviewRun(previous);
      const path = join(previous.run, `${target}.json`);
      const record = json(path); record.schemaVersion = 2;
      writeFileSync(path, JSON.stringify(record));
      if (target === "sheet-evidence") {
        const auditPath = join(previous.run, "sheet-review.json");
        const audit = json(auditPath);
        audit.manifestDigest = createHash("sha256").update(readFileSync(path)).digest("hex");
        writeFileSync(auditPath, JSON.stringify(audit));
      }
      const current = makeRun(root, "current");
      // when
      const result = report(current, previous);
      // then
      assert.equal(result.status, "draft", `${target} must use the current evidence protocol`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
for (const [condition, mutate] of [
  ["oversized common masks", (record) => { record.masks[0].rects[0].width = 295; return record; }],
  ["excessive common coverage", (record) => { record.masks[0].rects = Array.from({ length: 4 }, () => ({ ...record.masks[0].rects[0] })); return record; }]
]) {
  test(`given ${condition}, when both captures have identical geometry, then their masks still cannot authorize inheritance`, { skip }, () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-common-unsafe-mask-"));
    try {
      const previous = maskedRun(root, "previous", "time", "12:34", { mutate }); reviewRun(previous);
      const current = maskedRun(root, "current", "time", "12:35", { mutate });
      // when
      const result = report(current, previous);
      // then
      assert.equal(result.status, "draft", `${condition} cannot erase arbitrary evidence`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("given a comparison sidecar exchanged after opening, when sheets record its digest, then the original opened file remains the evidence", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-sidecar-race-"));
  try {
    const current = maskedRun(root, "current", "time", "12:34");
    const path = join(current.run, "shots", "desktop-chrome", "memberA", "overview", "01-account.comparison.json");
    const original = readFileSync(path);
    const external = join(root, "outside.json");
    writeFileSync(external, '{"outside":true}');
    const open = fs.openSync;
    const read = fs.readFileSync;
    let opened;
    let exchanged = false;
    mock.method(fs, "openSync", (...args) => {
      const descriptor = open(...args);
      if (args[0] === path) opened = descriptor;
      return descriptor;
    });
    mock.method(fs, "readFileSync", (file, ...args) => {
      if (!exchanged && (file === path || (opened !== undefined && file === opened))) {
        fs.renameSync(path, `${path}.original`);
        symlinkSync(external, path);
        exchanged = true;
      }
      return read(file, ...args);
    });
    syncBuiltinESMExports();
    // when
    contactSheets(current.run);
    // then
    assert.equal(exchanged, true, "the filename actually changes at the read boundary");
    assert.equal(json(join(current.run, "sheet-evidence.json")).sheets[0].tiles[0].viewport.comparisonDigest,
      createHash("sha256").update(original).digest("hex"), "the opened record cannot become the replacement symlink target");
    assert.throws(() => fs.fstatSync(opened), { code: "EBADF" }, "the evidence reader releases its file descriptor");
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("given a comparison sidecar is an external symlink, when sheets record evidence, then that record cannot supply a digest", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-sidecar-symlink-"));
  try {
    const current = maskedRun(root, "current", "time", "12:34");
    const path = join(current.run, "shots", "desktop-chrome", "memberA", "overview", "01-account.comparison.json");
    const external = join(root, "outside.json");
    copyFileSync(path, external); rmSync(path); symlinkSync(external, path);
    // when
    contactSheets(current.run);
    // then
    assert.equal(json(join(current.run, "sheet-evidence.json")).sheets[0].tiles[0].viewport.comparisonDigest, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given a comparison sidecar is a named pipe, when sheets record evidence, then unsupported streams are rejected without reading", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-sidecar-pipe-"));
  try {
    const current = maskedRun(root, "current", "time", "12:34");
    const path = join(current.run, "shots", "desktop-chrome", "memberA", "overview", "01-account.comparison.json");
    rmSync(path);
    const binary = findExecutable("mkfifo");
    assert.ok(binary, "the native fixture requires the POSIX named-pipe tool");
    execFileSync(binary, [path]);
    // when
    const result = spawnSync(process.execPath, ["--input-type=module", "-e",
      'const { contactSheets } = await import(process.argv[1]); contactSheets(process.argv[2]);',
      new URL("../acceptance/report/sheets.mjs", import.meta.url).href, current.run], { timeout: 8000, encoding: "utf8" });
    // then
    assert.equal(result.status, 0, "recording evidence must finish without waiting for a pipe writer");
    assert.equal(json(join(current.run, "sheet-evidence.json")).sheets[0].tiles[0].viewport.comparisonDigest, null,
      "only regular comparison files can supply an evidence digest");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const mode of ["raw", "masked"]) {
  test(`given a ${mode} PNG exchanged after source hashing, when ImageMagick compares, then the original defect cannot inherit a clean verdict`, { skip }, () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-pixel-race-"));
    try {
      const previous = mode === "raw" ? makeRun(root, "previous") : maskedRun(root, "previous", "time", "12:34");
      reviewRun(previous);
      const current = mode === "raw" ? makeRun(root, "current", { defect: true, defectColor: "black" })
        : maskedRun(root, "current", "time", "12:35", { defect: true, defectColor: "black" });
      const clean = mode === "raw" ? previous : maskedRun(root, "clean-current", "time", "12:35");
      const image = (entry) => join(entry.run, "shots", "desktop-chrome", "memberA", "overview", "01-account.png");
      const exec = childProcess.execFileSync;
      let exchanged = false;
      mock.method(childProcess, "execFileSync", (binary, args, options) => {
        if (!exchanged && (mode === "raw" || args.includes("-draw"))) {
          copyFileSync(image(clean), image(current));
          exchanged = true;
        }
        return exec(binary, args, options);
      });
      syncBuiltinESMExports();
      // when
      const result = report(current, previous);
      // then
      assert.equal(exchanged, true, "the image filename changes at the actual comparison boundary");
      assert.equal(result.status, "draft", "the compared pixels must be the bytes whose hash was validated");
    } finally {
      mock.restoreAll();
      syncBuiltinESMExports();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("given a valid comparison sidecar replaced with a pipe, when the report reads it, then the reading finishes with a manual verdict required", { skip }, () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "sheet-inheritance-sidecar-consumer-pipe-"));
  try {
    const previous = maskedRun(root, "previous", "time", "12:34"); reviewRun(previous);
    const current = maskedRun(root, "current", "time", "12:35");
    const path = join(current.run, "shots", "desktop-chrome", "memberA", "overview", "01-account.comparison.json");
    rmSync(path);
    const binary = findExecutable("mkfifo");
    assert.ok(binary, "the native fixture requires the POSIX named-pipe tool");
    execFileSync(binary, [path]);
    // when
    const result = spawnSync(process.execPath, ["--input-type=module", "-e",
      'const { renderReport } = await import(process.argv[1]); const result = renderReport(process.argv[2], JSON.parse(process.argv[3]), JSON.parse(process.argv[4])); process.stdout.write(result.status);',
      new URL("../acceptance/report/html.mjs", import.meta.url).href, current.run, JSON.stringify(config),
      JSON.stringify({ harnessCommit: "fixture", sheets: current.sheets, previous: previous.run })], { timeout: 8000, encoding: "utf8" });
    // then
    assert.equal(result.status, 0, "comparison must finish without waiting for a sidecar pipe writer");
    assert.equal(result.stdout, "draft", "a stream cannot supply an inherited clean judgment");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
