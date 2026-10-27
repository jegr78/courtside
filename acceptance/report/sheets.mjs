import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { findExecutable } from "../lib/executable.mjs";
import { readEvidence } from "./evidence-file.mjs";

const walk = (directory) => readdirSync(directory).flatMap((name) => {
  const path = join(directory, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

const FONT_DIRECTORIES = ["/System/Library/Fonts/Supplemental", "/Library/Fonts", "/System/Library/Fonts", "/usr/share/fonts", "/usr/local/share/fonts"];

export function findFont(directories = FONT_DIRECTORIES) {
  for (const directory of directories) {
    if (!existsSync(directory)) continue;
    const font = walk(directory).filter((path) => /\.ttf$/i.test(path)).sort()[0];
    if (font) return font;
  }
  return null;
}

export function imageMagick() {
  const montage = findExecutable("montage");
  if (montage) return { montage: (args) => [montage, args], convert: (args) => [findExecutable("magick") ?? findExecutable("convert"), args] };
  const magick = findExecutable("magick");
  if (magick) return { montage: (args) => [magick, ["montage", ...args]], convert: (args) => [magick, args] };
  return null;
}

function comparisonDigest(path) {
  try { return createHash("sha256").update(readEvidence(path)).digest("hex"); } catch { return null; }
}

function deviceClass(project) {
  if (project.startsWith("desktop-")) return "desktop";
  if (project === "ipad") return "tablet";
  if (/^(iphone-|pixel-|narrow$)/.test(project)) return project.includes("landscape") ? "landscape" : "portrait";
  return "unknown";
}

export function contactSheets(run) {
  const tool = imageMagick();
  const root = join(run, "shots");
  const directory = join(run, "sheets");
  rmSync(directory, { recursive: true, force: true });
  rmSync(join(run, "sheet-evidence.json"), { force: true });
  if (!existsSync(root)) return { sheets: 0, names: [], entries: [], skipped: "no screenshots" };
  if (!tool) return { sheets: 0, names: [], entries: [], skipped: "ImageMagick not found on PATH", unavailable: "ImageMagick not found on PATH" };
  const surfaces = new Map();
  for (const path of walk(root).filter((candidate) => candidate.endsWith(".png") && !candidate.endsWith("-full.png") && !candidate.includes("/mail/"))) {
    const [project, persona, testSlug, file] = path.slice(root.length + 1).split("/");
    const kind = deviceClass(project);
    const surface = `${persona}--${testSlug}--${file.replace(/^\d+-/, "").replace(/\.png$/, "")}--${kind}`;
    if (!surfaces.has(surface)) surfaces.set(surface, { kind, tiles: [] });
    const full = path.replace(/\.png$/, "-full.png");
    const header = readFileSync(path);
    if (header.length < 33 || !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || header.readUInt32BE(8) !== 13 || header.toString("ascii", 12, 16) !== "IHDR"
      || header.readUInt32BE(16) === 0 || header.readUInt32BE(20) === 0) {
      const reason = `invalid PNG screenshot: ${project}/${persona}/${testSlug}/${file}`;
      return { sheets: 0, names: [], entries: [], skipped: reason, unavailable: reason };
    }
    surfaces.get(surface).tiles.push({ path, label: project, width: header.readUInt32BE(16), height: header.readUInt32BE(20),
      fullPage: existsSync(full) ? full : null });
  }
  mkdirSync(directory, { recursive: true });
  const font = findFont();
  const entries = [];
  for (const [surface, group] of [...surfaces].sort(([a], [b]) => a.localeCompare(b))) {
    group.tiles.sort((a, b) => a.label.localeCompare(b.label));
    const columns = group.kind === "portrait" ? 2 : 1;
    const chunkSize = group.kind === "portrait" ? 4 : 2;
    for (let offset = 0; offset < group.tiles.length; offset += chunkSize) {
      const tiles = group.tiles.slice(offset, offset + chunkSize);
      const name = `${surface}--${String(offset / chunkSize + 1).padStart(2, "0")}`;
      const [binary, args] = tool.montage([...tiles.flatMap((shot) => ["-label", shot.label, shot.path]), "-tile", `${columns}x`,
        "-geometry", "+6+6", "-gravity", "NorthWest", ...(font ? ["-font", font] : []), "-pointsize", "18", "-background", "#888", join(directory, `${name}.png`)]);
      try { execFileSync(binary, args, { stdio: "pipe" }); } catch (failure) {
        rmSync(directory, { recursive: true, force: true });
        const reason = `ImageMagick failed: ${String(failure.stderr ?? failure.message).trim().slice(0, 200)}`;
        return { sheets: 0, names: [], entries: [], skipped: reason, unavailable: reason };
      }
      entries.push({ name, columns, tiles });
    }
  }
  const image = (path) => {
    if (path === null) return null;
    const comparison = path.replace(/\.png$/, ".comparison.json");
    return { path: relative(run, path), digest: createHash("sha256").update(readFileSync(path)).digest("hex"),
      comparisonDigest: comparisonDigest(comparison) };
  };
  writeFileSync(join(run, "sheet-evidence.json"), JSON.stringify({ schemaVersion: 3,
    sheets: entries.map((entry) => ({ name: entry.name, columns: entry.columns,
      imageDigest: createHash("sha256").update(readFileSync(join(directory, `${entry.name}.png`))).digest("hex"),
      frameSignature: sheetFrameSignature(join(directory, `${entry.name}.png`), entry),
      tiles: entry.tiles.map((tile) => ({ label: tile.label, viewport: image(tile.path), fullPage: image(tile.fullPage) })) }))
  }, null, 2) + "\n", { mode: 0o600 });
  return { sheets: entries.length, names: entries.map((entry) => entry.name), entries };
}

export function sheetFrameSignature(path, entry) {
  const header = readFileSync(path);
  const columns = Math.min(entry.columns, entry.tiles.length);
  const cellWidth = header.readUInt32BE(16) / columns;
  const cellHeight = header.readUInt32BE(20) / Math.ceil(entry.tiles.length / entry.columns);
  const drawing = entry.tiles.map((tile, index) => {
    const x = index % columns * cellWidth + 6;
    const y = Math.floor(index / columns) * cellHeight + 6;
    return `rectangle ${x},${y} ${x + tile.width - 1},${y + tile.height - 1}`;
  }).join(" ");
  const [binary, args] = imageMagick().convert([path, "-fill", "#000000", "-draw", drawing, "-format", "%#", "info:"]);
  return execFileSync(binary, args, { encoding: "utf8" }).trim();
}

const sheetNames = (directory) => readdirSync(directory).filter((name) => name.endsWith(".png")).map((name) => name.slice(0, -4)).sort();

// Montage stamps creation dates into the file, so sheets compare by their pixels.
export function pixelSignature(path) {
  const tool = imageMagick();
  if (!tool) throw new Error("ImageMagick not found on PATH");
  const [binary, args] = tool.convert([path, "-format", "%#", "info:"]);
  return execFileSync(binary, args, { encoding: "utf8" }).trim();
}

export function sheetChanges(run, previous, { signature = pixelSignature } = {}) {
  const current = join(run, "sheets");
  const before = join(previous, "sheets");
  if (!existsSync(before)) return { unavailable: `the previous run ${previous} has no contact sheets` };
  const earlier = new Set(sheetNames(before));
  const names = existsSync(current) ? sheetNames(current) : [];
  const changed = [];
  const added = [];
  for (const name of names) {
    if (!earlier.has(name)) added.push(name);
    else if (signature(join(current, `${name}.png`)) !== signature(join(before, `${name}.png`))) changed.push(name);
  }
  return { changed, added, unchanged: names.length - changed.length - added.length };
}
