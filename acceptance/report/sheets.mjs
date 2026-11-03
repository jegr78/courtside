import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, rmSync, readFileSync } from "node:fs";
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
  if (!existsSync(root)) return { sheets: 0, names: [], entries: [], skipped: "no screenshots", unavailable: "the run produced no screenshots" };
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
  return { sheets: entries.length, names: entries.map((entry) => entry.name), entries };
}
