import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const MASK = "<redacted>";
const IMAGES = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".webm"]);
const INTERIM = /acceptance-temporary-[0-9a-f]+/g;
const HAS_INTERIM = /acceptance-temporary-[0-9a-f]+/;
// An aria snapshot prints a password textbox with whatever was typed into it.
const PASSWORD_BOX = /(textbox "[^"\n]*(?:Passwort|Password|password)[^"\n]*"[^\n:]*:) [^\n]+/g;

const MIN_BASE64 = 6;

// A value inside base64 depends on its offset, so each of the three alignments gives its own stable middle.
function base64Fragments(secret, alphabet) {
  if (secret.length < MIN_BASE64) return [];
  return [0, 1, 2].map((shift) => {
    const encoded = Buffer.from("\0".repeat(shift) + secret).toString(alphabet);
    const head = Math.ceil((shift * 4) / 3) + (shift ? 1 : 0);
    const tail = Math.ceil(((shift + Buffer.byteLength(secret)) % 3 ? 4 : 0));
    return encoded.slice(head, encoded.replace(/=+$/, "").length - tail);
  });
}

function encodedForms(secret) {
  const html = secret.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const unicode = [...secret].map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
  const form = new URLSearchParams({ v: secret }).toString().slice(2);
  return [...new Set([secret, JSON.stringify(secret).slice(1, -1), html, encodeURIComponent(secret), form, unicode,
    unicode.toUpperCase().replace(/\\U/g, "\\u"), ...base64Fragments(secret, "base64"), ...base64Fragments(secret, "base64url")])]
    .filter((variant) => variant.length > 0);
}

function redactText(text, secret) {
  let out = text.replace(PASSWORD_BOX, `$1 ${MASK}`).replace(INTERIM, MASK);
  for (const form of encodedForms(secret)) out = out.split(form).join(MASK);
  return out;
}

const holds = (buffer, secret) => encodedForms(secret).some((form) => buffer.includes(form)) || HAS_INTERIM.test(buffer.toString("latin1"));

// The check decodes what it reads instead of reusing the masking's encodings, so a form the masking misses still fails the run.
function decodings(text) {
  const json = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\(["\\/])/g, "$1");
  const html = text.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&(quot|apos|lt|gt|amp);/g, (_, name) => ({ quot: "\"", apos: "'", lt: "<", gt: ">", amp: "&" })[name]);
  const percent = text.replace(/\+/g, " ").replace(/(%[0-9a-fA-F]{2})+/g, (run) => { try { return decodeURIComponent(run); } catch { return run; } });
  const base64 = [...text.matchAll(/[A-Za-z0-9+/_-]{8,}={0,2}/g)].map(([chunk]) => Buffer.from(chunk.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1"));
  return [text, json, html, percent, ...base64];
}

const TYPED_BOX = /textbox "[^"\n]*(?:Passwort|Password|password)[^"\n]*"[^\n:]*: (?!<redacted>$)[^\n]+$/m;

function exposes(buffer, secret) {
  const text = buffer.toString("utf8");
  if (TYPED_BOX.test(text) || HAS_INTERIM.test(text)) return true;
  const latin = Buffer.from(secret, "utf8").toString("latin1");
  return decodings(text).some((decoded) => decoded.includes(secret) || decoded.includes(latin));
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : [];
  });
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Reads the entries of a zip archive without ZIP64 or encryption, as Playwright writes its traces. */
export function readZip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("no zip end record");
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error("broken zip directory");
    const method = buffer.readUInt16LE(at + 10);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const skip = nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    if (size === 0xffffffff || local === 0xffffffff) throw new Error(`zip64 entry ${name}`);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`zip entry ${name} uses method ${method}`);
    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    at += 46 + skip;
  }
  return entries;
}

export function writeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const packed = deflateRawSync(data);
    const nameBytes = Buffer.from(name, "utf8");
    const fields = (header) => {
      header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(8, 8);
      header.writeUInt16LE(0, 10); header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc32(data), 14);
      header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(nameBytes.length, 26);
    };
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    fields(local);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    fields(record.subarray(2));
    record.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    central.push(record, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const textual = (name) => !IMAGES.has(extname(name).toLowerCase());

/** Masks every password the harness typed in the text artefacts and trace archives of a run directory. */
export function redactRun(run, secret) {
  for (const path of files(run)) {
    const name = path.toLowerCase();
    if (name.endsWith(".zip")) {
      const buffer = readFileSync(path);
      let entries;
      try { entries = readZip(buffer); } catch { continue; }
      if (!entries.some((entry) => textual(entry.name) && holds(entry.data, secret))) continue;
      writeFileSync(path, writeZip(entries.map((entry) => textual(entry.name) && holds(entry.data, secret)
        ? { name: entry.name, data: Buffer.from(redactText(entry.data.toString("utf8"), secret)) } : entry)));
    } else if (textual(name)) {
      const text = readFileSync(path, "utf8");
      const redacted = redactText(text, secret);
      if (redacted !== text) writeFileSync(path, redacted);
    }
  }
}

/** Names every artefact that still holds a password, or that cannot be checked, relative to the run. */
export function leaksIn(run, secret) {
  const leaks = [];
  for (const path of files(run)) {
    const name = relative(run, path);
    if (path.toLowerCase().endsWith(".zip")) {
      let entries;
      try { entries = readZip(readFileSync(path)); } catch (error) { leaks.push(`${name} (unreadable: ${error.message})`); continue; }
      for (const entry of entries) if (textual(entry.name) && exposes(entry.data, secret)) leaks.push(`${name}!${entry.name}`);
    } else if (textual(path) && exposes(readFileSync(path), secret)) {
      leaks.push(name);
    }
  }
  return leaks;
}

export function secureRun(run, secret) {
  if (!statSync(run, { throwIfNoEntry: false })?.isDirectory()) return;
  redactRun(run, secret);
  const leaks = leaksIn(run, secret);
  if (leaks.length) throw new Error(`the run directory still holds a password: ${leaks.join(", ")}`);
}
