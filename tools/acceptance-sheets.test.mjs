import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { contactSheets, findFont, imageMagick } from "../acceptance/report/sheets.mjs";
import { renderReport } from "../acceptance/report/html.mjs";
import { applyReview } from "../acceptance/report/review.mjs";

const required = process.env.COURTSIDE_SHEET_RENDERER === "required";
const runsWithoutTooling = !required && !(imageMagick() && findFont());

test("given a job that requires the sheet renderer, when the contact sheet tests start, then ImageMagick and a font are available", { skip: !required }, () => {
  // then
  assert.ok(imageMagick(), "the job provides ImageMagick, otherwise the sheet tests below would not run");
  assert.ok(findFont(), "the job provides a TrueType font for the sheet labels");
});

function convert(args) {
  const [binary, argv] = imageMagick().convert(args);
  return execFileSync(binary, argv, { maxBuffer: 64 * 1024 * 1024 });
}
function shot(run, project, width, height, full = true) {
  const directory = join(run, "shots", project, "admin", "overview");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "01-table.png");
  convert(["-size", `${width}x${height}`, "xc:white", "-font", findFont(), "-pointsize", "18", "-fill", "black", "-annotate", "+20+40", "Court 1  |  23.10.2026  |  18:30", "-fill", "red", "-draw", "rectangle 20,80 39,99", path]);
  if (full) convert([path, "-extent", `${width}x${height + 400}`, path.replace(/\.png$/, "-full.png")]);
  return path;
}

test("given native desktop and phone captures, when sheets are rendered, then every source pixel survives with bounded device groups", { skip: runsWithoutTooling }, () => {
  // given
  const run = mkdtempSync(join(tmpdir(), "readable-sheets-"));
  try {
    shot(run, "desktop-chrome", 1440, 900);
    shot(run, "ipad", 1640, 2360);
    shot(run, "iphone-15-landscape", 2532, 1170);
    for (const name of ["iphone-15-de", "iphone-15-en", "iphone-se", "pixel-7", "narrow"]) shot(run, name, 960, 1920);
    shot(run, "future-device", 1000, 600);
    // when
    const sheets = contactSheets(run);
    // then
    assert.equal(sheets.unavailable, undefined);
    assert.equal(sheets.names.length, 6);
    assert.ok(sheets.names.includes("admin--overview--table--portrait--02"));
    for (const entry of sheets.entries) {
      const sheet = join(run, "sheets", `${entry.name}.png`);
      const header = readFileSync(sheet);
      const columns = Math.min(entry.columns, entry.tiles.length);
      const cellWidth = header.readUInt32BE(16) / columns;
      const cellHeight = header.readUInt32BE(20) / Math.ceil(entry.tiles.length / columns);
      for (const [index, tile] of entry.tiles.entries()) {
        const x = index % columns * cellWidth + 6;
        const y = Math.floor(index / columns) * cellHeight + 6;
        const crop = convert([sheet, "-crop", `${tile.width}x${tile.height}+${x}+${y}`, "+repage", "-depth", "8", "rgb:-"]);
        assert.ok(crop.equals(convert([tile.path, "-depth", "8", "rgb:-"])), `${entry.name} ${tile.label} retains every native pixel`);
      }
    }
    const old = { "admin--overview--table": { verdict: "clean", by: "reviewer" } };
    assert.equal(applyReview([], { sheets: old }, sheets).status, "draft");
    const partial = { [sheets.names[0]]: { verdict: "clean", by: "reviewer" } };
    assert.equal(applyReview([], { sheets: partial }, sheets).sheets.unreviewed.length, 5);
    const all = Object.fromEntries(sheets.names.map(name => [name, { verdict: "clean", by: "reviewer" }]));
    assert.equal(applyReview([], { sheets: all }, sheets).status, "final");
    rmSync(join(run, "shots", "ipad"), { recursive: true });
    const next = contactSheets(run);
    assert.deepEqual(readdirSync(join(run, "sheets")).sort(), next.names.map(name => `${name}.png`).sort());
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test("given colliding screenshot names and a missing full page, when the report renders, then tiles link to distinct unchanged originals", { skip: runsWithoutTooling }, () => {
  // given
  const run = mkdtempSync(join(tmpdir(), "sheet-report-"));
  try {
    const first = shot(run, "desktop-chrome", 1440, 900);
    const second = shot(run, "desktop-firefox", 1280, 800, false);
    const sheets = contactSheets(run);
    // when
    renderReport(run, { personas: {}, baseUrl: "https://example.org" }, { harnessCommit: "fixture", sheets });
    const html = readFileSync(join(run, "report", "index.html"), "utf8");
    // then
    const links = [...html.matchAll(/href="(img\/[^"]+\.png)"[^>]*>Full-size viewport/g)].map(match => match[1]);
    assert.equal(new Set(links).size, 2);
    assert.deepEqual(links.map(link => readFileSync(join(run, "report", link))), [first, second].map(path => readFileSync(path)));
    const full = [...html.matchAll(/href="(img\/[^"]+\.png)"[^>]*>Full-page/g)];
    assert.equal(full.length, 1);
    assert.deepEqual(readFileSync(join(run, "report", full[0][1])), readFileSync(first.replace(/\.png$/, "-full.png")));
    assert.match(html, /<section><h2>Contact sheets<\/h2>\s*<details class="sheet-gallery">/, "the gallery is its own report section");
    assert.match(html, /class="sheet-tiles"/);
    assert.match(html, /\.sheet-tiles img\s*\{[^}]*max-width:\s*none/);
  } finally { rmSync(run, { recursive: true, force: true }); }
});


test("given a truncated screenshot, when sheets are generated, then the report stays draft with unavailable evidence", { skip: !required && !imageMagick() }, () => {
  // given
  const run = mkdtempSync(join(tmpdir(), "broken-sheets-"));
  try {
    const directory = join(run, "shots", "desktop-chrome", "admin", "overview");
    mkdirSync(directory, { recursive: true });
    for (const bytes of [Buffer.from([137, 80, 78, 71]), Buffer.alloc(33)]) {
      writeFileSync(join(directory, "01-table.png"), bytes);
      // when
      const sheets = contactSheets(run);
      // then
      assert.match(sheets.unavailable, /invalid PNG screenshot/);
      assert.deepEqual(sheets.names, []);
      assert.equal(applyReview([], {}, sheets).status, "draft");
      assert.equal(existsSync(join(run, "sheets")), false);
    }
  } finally { rmSync(run, { recursive: true, force: true }); }
});
