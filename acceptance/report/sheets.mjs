import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { findExecutable } from "../lib/executable.mjs";

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

export function contactSheets(run) {
  const tool = imageMagick();
  const root = join(run, "shots");
  if (!existsSync(root)) return { sheets: 0, names: [], skipped: "no screenshots" };
  if (!tool) return { sheets: 0, names: [], skipped: "ImageMagick not found on PATH", unavailable: "ImageMagick not found on PATH" };
  const surfaces = new Map();
  for (const path of walk(root).filter((candidate) => candidate.endsWith(".png") && !candidate.endsWith("-full.png") && !candidate.includes("/mail/"))) {
    const [project, persona, testSlug, file] = path.slice(root.length + 1).split("/");
    const surface = `${persona}--${testSlug}--${file.replace(/^\d+-/, "").replace(/\.png$/, "")}`;
    if (!surfaces.has(surface)) surfaces.set(surface, []);
    surfaces.get(surface).push({ path, label: project });
  }
  mkdirSync(join(run, "sheets"), { recursive: true });
  // ImageMagick without a configured font cannot render the profile labels.
  const font = findFont();
  for (const [surface, shots] of surfaces) {
    shots.sort((a, b) => a.label.localeCompare(b.label));
    const [binary, args] = tool.montage([...shots.flatMap((shot) => ["-label", shot.label, shot.path]), "-tile", `${Math.min(shots.length, 6)}x`,
      "-geometry", "300x600>+6+6", ...(font ? ["-font", font] : []), "-pointsize", "13", "-background", "#888", join(run, "sheets", `${surface}.png`)]);
    try { execFileSync(binary, args, { stdio: "pipe" }); } catch (failure) {
      const reason = `ImageMagick failed: ${String(failure.stderr ?? failure.message).trim().slice(0, 200)}`;
      return { sheets: 0, names: [], skipped: reason, unavailable: reason };
    }
  }
  return { sheets: surfaces.size, names: [...surfaces.keys()].sort() };
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
