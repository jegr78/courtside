import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { readZip, writeZip } from "./zip.mjs";

export { readZip, writeZip };

const MASK = "<redacted>";
const IMAGES = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".webm"]);
const INTERIM = /acceptance-temporary-[0-9a-f]+/g;
const HAS_INTERIM = /acceptance-temporary-[0-9a-f]+/;
const PASSWORD_NAME = /pass(word|wort)?|secret|credential/i;
// An aria snapshot prints a password textbox with whatever was typed into it.
const PASSWORD_BOX = /(textbox "[^"\n]*(?:Passwort|Password|password)[^"\n]*"[^\n:]*:) [^\n]+/g;
const TYPED_BOX = /textbox "[^"\n]*(?:Passwort|Password|password)[^"\n]*"[^\n:]*: (?!<redacted>$)[^\n]+$/m;
const BASE64_TOKEN = /[A-Za-z0-9+/_-]{8,}={0,2}/g;
const MIN_BASE64 = 6;
const DEPTH = 3;

const textual = (name) => !IMAGES.has(extname(name).toLowerCase());

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : [];
  });
}

const PASSWORD_FIELD = /(^|[&{,"\s])"?(pass(word|wort)?|secret|credential)"?\s*[=:]/i;

function carriesPassword(postData, stored) {
  if (!postData) return false;
  return (postData.params ?? []).some((param) => PASSWORD_NAME.test(param.name ?? ""))
    || PASSWORD_FIELD.test(postData.text ?? "") || PASSWORD_FIELD.test(stored?.toString("utf8") ?? "");
}

function scrubNode(node) {
  if (!Array.isArray(node) || typeof node[0] !== "string") return;
  const attributes = node[1];
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)
    && String(attributes.type ?? "").toLowerCase() === "password") delete attributes.__playwright_value_;
  for (const child of node.slice(2)) scrubNode(child);
}

function scrubTrace(entries) {
  const byName = new Map(entries.map((entry) => [entry.name, entry.data]));
  const dropped = new Set();
  const scrubbed = entries.map((entry) => {
    if (!/\.(trace|network)$/.test(entry.name)) return entry;
    const lines = entry.data.toString("utf8").split("\n").map((line) => {
      if (!line.trim()) return line;
      let event;
      try { event = JSON.parse(line); } catch { return line; }
      const postData = event.snapshot?.request?.postData;
      if (carriesPassword(postData, byName.get(postData?._file) ?? byName.get(`resources/${postData?._sha1}`))) {
        if (postData._file) dropped.add(postData._file);
        if (postData._sha1) dropped.add(`resources/${postData._sha1}`);
        event.snapshot.request.postData = { mimeType: postData.mimeType, text: MASK, params: [] };
      }
      if (event.type === "frame-snapshot") scrubNode(event.snapshot?.html);
      return JSON.stringify(event);
    });
    return { name: entry.name, data: Buffer.from(lines.join("\n")) };
  });
  return scrubbed.filter((entry) => !dropped.has(entry.name));
}

// A value inside base64 depends on its offset, so each of the three alignments gives its own stable middle.
function base64Fragments(value) {
  if (value.length < MIN_BASE64) return [];
  return ["base64", "base64url"].flatMap((alphabet) => [0, 1, 2].map((shift) => {
    const encoded = Buffer.from("\0".repeat(shift) + value).toString(alphabet).replace(/=+$/, "");
    const head = shift ? Math.ceil((shift * 4) / 3) + 1 : 0;
    const tail = (shift + Buffer.byteLength(value)) % 3 ? 4 : 0;
    return encoded.slice(head, encoded.length - tail);
  })).filter((fragment) => fragment.length >= 4);
}

function textForms(secret) {
  const html = secret.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const unicode = [...secret].map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
  const form = new URLSearchParams({ v: secret }).toString().slice(2);
  return [...new Set([secret, JSON.stringify(secret).slice(1, -1), html, encodeURIComponent(secret), form, unicode])];
}

function maskBase64Tokens(text, fragments) {
  return text.replace(BASE64_TOKEN, (token) => fragments.some((fragment) => token.includes(fragment)) ? MASK : token);
}

function redactText(text, secret) {
  const forms = textForms(secret);
  let out = text.replace(PASSWORD_BOX, `$1 ${MASK}`).replace(INTERIM, MASK);
  out = maskBase64Tokens(out, forms.flatMap(base64Fragments));
  for (const form of forms) out = out.split(form).join(MASK);
  return out;
}

/** Strips password bodies and fields from traces and masks every password the harness typed in a run directory. */
export function redactRun(run, secret) {
  for (const path of files(run)) {
    if (path.toLowerCase().endsWith(".zip")) {
      let entries;
      try { entries = readZip(readFileSync(path)); } catch { continue; }
      writeFileSync(path, writeZip(scrubTrace(entries).map((entry) => textual(entry.name)
        ? { name: entry.name, data: Buffer.from(redactText(entry.data.toString("utf8"), secret)) } : entry)));
    } else if (textual(path)) {
      const text = readFileSync(path, "utf8");
      const redacted = redactText(text, secret);
      if (redacted !== text) writeFileSync(path, redacted);
    }
  }
}

// The check decodes what is there instead of reusing the masking's encodings, so a form the masking misses still fails.
function decodeLayer(text) {
  const out = [];
  const json = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\(["\\/])/g, "$1");
  const html = text.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&(quot|apos|lt|gt|amp);/g, (_, name) => ({ quot: "\"", apos: "'", lt: "<", gt: ">", amp: "&" })[name]);
  const percent = text.replace(/\+/g, " ").replace(/(%[0-9a-fA-F]{2})+/g, (run) => { try { return decodeURIComponent(run); } catch { return run; } });
  for (const candidate of [json, html, percent]) if (candidate !== text) out.push(candidate);
  const unwrapped = text.replace(/([A-Za-z0-9+/_=-])[ \t]*\r?\n[ \t]*(?=[A-Za-z0-9+/_=-])/g, "$1");
  for (const [token] of unwrapped.matchAll(/[A-Za-z0-9+/_-]{12,}={0,2}/g)) {
    out.push(Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1"));
  }
  return out;
}

function partsOf(secret) {
  const length = Math.min(secret.length, Math.max(8, Math.ceil(secret.length / 2)));
  return [...new Set([secret.slice(0, length), secret.slice(-length)])];
}

function exposes(buffer, secret) {
  const text = buffer.toString("utf8");
  if (TYPED_BOX.test(text) || HAS_INTERIM.test(text)) return true;
  const parts = [...partsOf(secret), ...partsOf(Buffer.from(secret, "utf8").toString("latin1"))];
  let frontier = [text];
  for (let depth = 0; depth <= DEPTH && frontier.length; depth++) {
    if (frontier.some((decoded) => parts.some((part) => decoded.includes(part)))) return true;
    frontier = depth < DEPTH ? [...new Set(frontier.flatMap(decodeLayer))] : [];
  }
  return false;
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
