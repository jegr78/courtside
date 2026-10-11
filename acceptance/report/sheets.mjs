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
  if (!tool) return { sheets: 0, skipped: "ImageMagick not found on PATH" };
  const root = join(run, "shots");
  if (!existsSync(root)) return { sheets: 0, skipped: "no screenshots" };
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
      return { sheets: 0, skipped: `ImageMagick failed: ${String(failure.stderr ?? failure.message).trim().slice(0, 200)}` };
    }
  }
  return { sheets: surfaces.size };
}
