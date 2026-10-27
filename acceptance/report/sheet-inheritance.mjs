import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { pixelSignature, sheetChanges } from "./sheets.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const reviewDigest = (run) => digest(existsSync(join(run, "review.json")) ? readFileSync(join(run, "review.json")) : "null");

function manifest(run) {
  const path = join(run, "sheet-evidence.json");
  const evidence = read(path);
  if (evidence.schemaVersion !== 1 || !Array.isArray(evidence.sheets)
    || new Set(evidence.sheets.map((sheet) => sheet.name)).size !== evidence.sheets.length) throw new Error("Incompatible sheet evidence");
  return { evidence, digest: digest(readFileSync(path)) };
}

function imagePath(run, image) {
  if (!image || typeof image.path !== "string" || isAbsolute(image.path) || image.path.split(/[\\/]/).includes("..")
    || !image.path.startsWith("shots/") || !/\.png$/.test(image.path)) throw new Error("Unsafe screenshot evidence path");
  const root = realpathSync(run);
  const path = resolve(root, image.path);
  if (!path.startsWith(join(root, "shots") + sep) || realpathSync(path) !== path
    || digest(readFileSync(path)) !== image.digest) throw new Error("Screenshot evidence changed");
  return path;
}

function matchingSheet(current, previous, now, before) {
  if (now.columns !== before.columns || now.tiles.length !== before.tiles.length) return false;
  return now.tiles.every((tile, index) => {
    const earlier = before.tiles[index];
    if (tile.label !== earlier.label) return false;
    return ["viewport", "fullPage"].every((kind) => {
      const image = tile[kind];
      const oldImage = earlier[kind];
      if (!image || !oldImage) return false;
      if (image.path !== oldImage.path) return false;
      return pixelSignature(imagePath(current, image)) === pixelSignature(imagePath(previous, oldImage));
    });
  });
}

function trustedVerdict(audit, manual, name) {
  const entry = audit.verdicts?.[name];
  if (!entry || entry.verdict !== "clean" || typeof entry.by !== "string" || !entry.by.trim()) return null;
  if (entry.by.startsWith("inherited:")) {
    return typeof audit.previous === "string" && entry.by === `inherited:${audit.previous}`
      && Array.isArray(audit.inherited) && audit.inherited.includes(name) ? entry : null;
  }
  const original = manual.sheets?.[name];
  return original?.verdict === "clean" && original.by === entry.by ? entry : null;
}

export function inheritSheetVerdicts(run, previous, sheets, review) {
  for (const [name, entry] of Object.entries(review.sheets ?? {})) {
    if (typeof entry.by === "string" && entry.by.startsWith("inherited:")) {
      throw new Error(`review sheet ${name}: inherited verdicts belong in generated sheet-review.json`);
    }
  }
  const inherited = {};
  let changes = null;
  let previousName = null;
  if (previous && sheets) {
    try {
      if (realpathSync(run) === realpathSync(previous)) throw new Error("The previous run is the current run");
      previousName = basename(previous);
      const current = manifest(run);
      const earlier = manifest(previous);
      const audit = read(join(previous, "sheet-review.json"));
      if (audit.schemaVersion !== 1 || audit.manifestDigest !== earlier.digest || audit.reviewDigest !== reviewDigest(previous)) {
        throw new Error("Previous review evidence is stale");
      }
      const manual = existsSync(join(previous, "review.json")) ? read(join(previous, "review.json")) : {};
      const old = new Map(earlier.evidence.sheets.map((sheet) => [sheet.name, sheet]));
      const changed = [];
      const added = [];
      const unchanged = [];
      for (const sheet of current.evidence.sheets) {
        const before = old.get(sheet.name);
        if (!before) { added.push(sheet.name); continue; }
        let same = false;
        try { same = matchingSheet(run, previous, sheet, before); } catch { /* Invalid evidence requires a new reading. */ }
        if (!same) { changed.push(sheet.name); continue; }
        unchanged.push(sheet.name);
        if (!review.sheets?.[sheet.name] && trustedVerdict(audit, manual, sheet.name)) {
          inherited[sheet.name] = { verdict: "clean", by: `inherited:${previousName}` };
        }
      }
      changes = { changed, added, unchanged: unchanged.length };
    } catch (failure) {
      try { changes = { ...sheetChanges(run, previous), inheritanceUnavailable: failure.message }; }
      catch { changes = { unavailable: failure.message }; }
    }
  }
  return { review: { ...review, sheets: { ...inherited, ...review.sheets } }, inherited: Object.keys(inherited), previous: previousName, changes };
}

export function writeSheetReview(run, inheritance, reviewed) {
  let evidenceDigest = null;
  try { evidenceDigest = manifest(run).digest; } catch { /* Unavailable evidence cannot become an inheritance source. */ }
  writeFileSync(join(run, "sheet-review.json"), JSON.stringify({ schemaVersion: 1, manifestDigest: evidenceDigest,
    reviewDigest: reviewDigest(run), previous: inheritance.previous, inherited: inheritance.inherited,
    verdicts: inheritance.review.sheets ?? {} }, null, 2) + "\n");
  const pending = reviewed.sheets?.unreviewed ?? [];
  const batches = [];
  for (let offset = 0; offset < pending.length; offset += 8) batches.push(pending.slice(offset, offset + 8));
  writeFileSync(join(run, "review-batches.json"), JSON.stringify({ schemaVersion: 1, batchSize: 8, batches }, null, 2) + "\n");
}
