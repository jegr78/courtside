import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { imageMagick } from "./sheets.mjs";
import { readEvidence } from "./evidence-file.mjs";

const KINDS = new Set(["date", "time", "count", "version", "generated-name"]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const finite = (number) => typeof number === "number" && Number.isFinite(number);

function comparison(source, evidence) {
  const metadata = source.path.replace(/\.png$/, ".comparison.json");
  if (!evidence.comparisonDigest || realpathSync(metadata) !== metadata) throw new Error("Comparison evidence unavailable");
  const bytes = readEvidence(metadata);
  if (digest(bytes) !== evidence.comparisonDigest) throw new Error("Comparison evidence changed");
  const record = JSON.parse(bytes.toString("utf8"));
  const capture = record.capture;
  const width = source.bytes.readUInt32BE(16);
  const height = source.bytes.readUInt32BE(20);
  if (record.schemaVersion !== 3 || record.safe !== true || record.image?.digest !== evidence.digest
    || record.image.width !== width || record.image.height !== height || !capture
    || !finite(capture.width) || !finite(capture.height) || capture.width <= 0 || capture.height <= 0
    || !finite(capture.devicePixelRatio) || capture.devicePixelRatio < 1 || capture.devicePixelRatio > 4
    || Math.round(capture.width * capture.devicePixelRatio) !== width || Math.round(capture.height * capture.devicePixelRatio) !== height
    || !["viewport", "full"].includes(capture.mode) || typeof capture.userAgent !== "string" || capture.userAgent.length > 512
    || typeof capture.locale !== "string" || !capture.locale || capture.locale.length > 128
    || typeof capture.timeZone !== "string" || !capture.timeZone || capture.timeZone.length > 128
    || !finite(capture.scrollX) || !finite(capture.scrollY)
    || !Array.isArray(record.masks) || record.masks.length === 0 || record.masks.length > 500) throw new Error("Invalid comparison evidence");
  const keys = new Set();
  let area = 0;
  for (const mask of record.masks) {
    if (!mask || !KINDS.has(mask.kind) || typeof mask.key !== "string" || mask.key.length > 512 || keys.has(mask.key)
      || typeof mask.style !== "string" || !mask.style || mask.style.length > 2048
      || !Array.isArray(mask.rects) || mask.rects.length === 0 || mask.rects.length > 4) throw new Error("Invalid run-data mask");
    keys.add(mask.key);
    for (const rect of mask.rects) {
      if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(finite) || rect.x < 0 || rect.y < 0
        || rect.width <= 0 || rect.height <= 0 || rect.width > capture.width * 0.8 || rect.height > 64
        || rect.x + rect.width > capture.width || rect.y + rect.height > capture.height) throw new Error("Unsafe run-data mask");
      area += rect.width * rect.height;
    }
  }
  if (area > capture.width * capture.height * 0.2) throw new Error("Run-data masks cover too much evidence");
  return record;
}

function imageSignature(source, rectangles = [], density = 1) {
  const drawing = rectangles.map((rect) => `rectangle ${Math.floor(rect.x * density)},${Math.floor(rect.y * density)} ${Math.ceil((rect.x + rect.width) * density) - 1},${Math.ceil((rect.y + rect.height) * density) - 1}`).join(" ");
  const [binary, args] = imageMagick().convert(["png:-", ...(drawing ? ["-fill", "#000000", "-draw", drawing] : []), "-format", "%#", "info:"]);
  return execFileSync(binary, args, { input: source.bytes, encoding: "utf8" }).trim();
}

export function matchingImages(source, evidence, previous, oldEvidence) {
  if (imageSignature(source) === imageSignature(previous)) return true;
  const now = comparison(source, evidence);
  const before = comparison(previous, oldEvidence);
  if (JSON.stringify(now.capture) !== JSON.stringify(before.capture) || now.masks.length !== before.masks.length) return false;
  const rectangles = [];
  for (const [index, mask] of now.masks.entries()) {
    const old = before.masks[index];
    if (mask.key !== old.key || mask.kind !== old.kind || mask.style !== old.style || mask.rects.length !== old.rects.length) return false;
    for (const [position, rect] of mask.rects.entries()) {
      const earlier = old.rects[position];
      if (rect.x !== earlier.x || rect.y !== earlier.y || rect.height !== earlier.height || rect.width !== earlier.width) return false;
      rectangles.push(rect);
    }
  }
  if (rectangles.reduce((sum, rect) => sum + rect.width * rect.height, 0) > now.capture.width * now.capture.height * 0.2) return false;
  return imageSignature(source, rectangles, now.capture.devicePixelRatio)
    === imageSignature(previous, rectangles, now.capture.devicePixelRatio);
}
