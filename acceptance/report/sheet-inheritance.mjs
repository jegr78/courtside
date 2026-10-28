import { createHash } from "node:crypto";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { sheetChanges } from "./sheets.mjs";
import { matchingImages } from "./image-comparison.mjs";
import { readEvidence } from "./evidence-file.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (path) => JSON.parse(readEvidence(path).toString("utf8"));

function manifest(run) {
  const path = join(run, "sheet-evidence.json");
  const bytes = readEvidence(path);
  const evidence = JSON.parse(bytes.toString("utf8"));
  if (evidence.schemaVersion !== 3 || !Array.isArray(evidence.sheets)
    || new Set(evidence.sheets.map((sheet) => sheet.name)).size !== evidence.sheets.length) throw new Error("Incompatible sheet evidence");
  return { evidence, digest: digest(bytes) };
}

function imageSource(run, image) {
  if (!image || typeof image.path !== "string" || isAbsolute(image.path) || image.path.split(/[\\/]/).includes("..")
    || !image.path.startsWith("shots/") || !/\.png$/.test(image.path)) throw new Error("Unsafe screenshot evidence path");
  const root = realpathSync(run);
  const path = resolve(root, image.path);
  if (!path.startsWith(join(root, "shots") + sep) || realpathSync(path) !== path) throw new Error("Unsafe screenshot evidence path");
  const bytes = readEvidence(path);
  if (digest(bytes) !== image.digest) throw new Error("Screenshot evidence changed");
  return { path, bytes };
}

function matchingSheet(current, previous, now, before) {
  for (const [run, sheet] of [[current, now], [previous, before]]) {
    if (typeof sheet.name !== "string" || !/^[a-zA-Z0-9_.-]+$/.test(sheet.name)) return false;
    const path = join(realpathSync(run), "sheets", `${sheet.name}.png`);
    if (realpathSync(path) !== path || digest(readEvidence(path)) !== sheet.imageDigest) return false;
  }
  if (typeof now.frameSignature !== "string" || !/^[a-f0-9]{64}$/.test(now.frameSignature)
    || now.frameSignature !== before.frameSignature) return false;
  if (now.columns !== before.columns || now.tiles.length !== before.tiles.length) return false;
  return now.tiles.every((tile, index) => {
    const earlier = before.tiles[index];
    if (tile.label !== earlier.label) return false;
    return ["viewport", "fullPage"].every((kind) => {
      const image = tile[kind];
      const oldImage = earlier[kind];
      if (!image || !oldImage) return false;
      if (image.path !== oldImage.path) return false;
      return matchingImages(imageSource(current, image), image, imageSource(previous, oldImage), oldImage);
    });
  });
}

function withinRuns(message, run, previous) {
  const roots = [[previous, basename(previous)], [run, "."]]
    .flatMap(([root, name]) => [resolve(root), ...(existsSync(root) ? [realpathSync(root)] : [])].map((path) => [path, name]));
  return roots.flatMap(([path, name]) => [[path + sep, name === "." ? "" : `${name}/`], [path, name]])
    .reduce((text, [path, name]) => text.replaceAll(path, name), String(message));
}

function trustedVerdict(audit, manual, name) {
  const entry = audit.verdicts?.[name];
  if (!entry || entry.verdict !== "clean" || typeof entry.by !== "string" || !entry.by.trim()) return null;
  if (entry.by.startsWith("inherited:")) {
    if (manual.sheets?.[name]) return null;
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
      let reviewBytes;
      try { reviewBytes = readEvidence(join(previous, "review.json")); } catch (failure) {
        if (failure.code !== "ENOENT") throw failure;
        reviewBytes = Buffer.from("null");
      }
      if (audit.schemaVersion !== 3 || audit.manifestDigest !== earlier.digest || audit.reviewDigest !== digest(reviewBytes)) {
        throw new Error("Previous review evidence is stale");
      }
      const manual = JSON.parse(reviewBytes.toString("utf8")) ?? {};
      const old = new Map(earlier.evidence.sheets.map((sheet) => [sheet.name, sheet]));
      const changed = [];
      const added = [];
      const unchanged = [];
      const unverifiable = {};
      for (const sheet of current.evidence.sheets) {
        const before = old.get(sheet.name);
        if (!before) { added.push(sheet.name); continue; }
        let same = false;
        try { same = matchingSheet(run, previous, sheet, before); } catch (failure) { unverifiable[sheet.name] = withinRuns(failure.message, run, previous); }
        if (!same) { changed.push(sheet.name); continue; }
        unchanged.push(sheet.name);
        if (!review.sheets?.[sheet.name] && trustedVerdict(audit, manual, sheet.name)) {
          inherited[sheet.name] = { verdict: "clean", by: `inherited:${previousName}` };
        }
      }
      changes = { changed, added, unchanged: unchanged.length, unverifiable };
    } catch (failure) {
      const known = ["The previous run is the current run", "Incompatible sheet evidence", "Previous review evidence is stale"];
      const reason = known.includes(failure.message) ? failure.message
        : `Previous review or screenshot evidence is missing or invalid: ${withinRuns(failure.message, run, previous)}`;
      try {
        const fallback = sheetChanges(run, previous);
        changes = fallback.unavailable ? { unavailable: reason } : { ...fallback, inheritanceUnavailable: reason };
      } catch { changes = { unavailable: reason }; }
    }
  }
  return { review: { ...review, sheets: { ...inherited, ...review.sheets } }, inherited: Object.keys(inherited), previous: previousName, changes };
}

export function writeSheetReview(run, inheritance, reviewed, reviewHash) {
  let evidenceDigest = null;
  try { evidenceDigest = manifest(run).digest; } catch { /* Unavailable evidence cannot become an inheritance source. */ }
  writeFileSync(join(run, "sheet-review.json"), JSON.stringify({ schemaVersion: 3, manifestDigest: evidenceDigest,
    reviewDigest: reviewHash, previous: inheritance.previous, inherited: inheritance.inherited,
    verdicts: inheritance.review.sheets ?? {} }, null, 2) + "\n", { mode: 0o600 });
  const pending = reviewed.sheets?.unreviewed ?? [];
  const batches = [];
  for (let offset = 0; offset < pending.length; offset += 8) batches.push(pending.slice(offset, offset + 8));
  writeFileSync(join(run, "review-batches.json"), JSON.stringify({ schemaVersion: 1, batchSize: 8, batches }, null, 2) + "\n", { mode: 0o600 });
}
