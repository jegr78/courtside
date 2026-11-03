import { PASSWORD, runPath } from "./context";
import { appendFileSync, mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { layoutProbe, layoutProbeArguments } from "./layout-probe.mjs";
import { showSubject } from "./subject.mjs";

export async function measure(page: Page, locale: "de" | "en") {
  return page.evaluate(layoutProbe, layoutProbeArguments(locale));
}

type ConsoleEvent = {
  kind: "console" | "pageerror"; message: string; observedAt: string; phase: string;
  stack: string | null; location: { url: string; lineNumber: number; columnNumber: number } | null;
};
type Watched = { console: string[]; consoleEvents: ConsoleEvent[]; phase: string; capture: string | null;
  httpErrors: { url: string; status: number }[] };
const watched = new WeakMap<Page, Watched>();
const personaOf = new WeakMap<Page, string>();
const counters = new Map<string, number>();

export function setPersona(page: Page, key: string) { personaOf.set(page, key); }

const slug = (title: string) => title.replace(/^given |^when /, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 40).replace(/-$/, "");

export function watch(page: Page) {
  const existing = watched.get(page);
  if (existing) return existing;
  const record: Watched = { console: [], consoleEvents: [], phase: "journey", capture: null, httpErrors: [] };
  const owner = { project: test.info().project.name, test: test.info().title };
  watched.set(page, record);
  const add = (kind: ConsoleEvent["kind"], text: string, stack?: string, location?: ConsoleEvent["location"]) => {
    const message = text.replaceAll(PASSWORD, "<redacted>");
    const event: ConsoleEvent = { kind, message, observedAt: new Date().toISOString(), phase: record.phase,
      stack: stack ? safeStack(stack) : null,
      location: location?.url ? { ...location, url: sourcePath(location.url) } : null };
    record.console.push(message);
    record.consoleEvents.push(event);
    appendFileSync(runPath("browser-events.jsonl"), JSON.stringify({ ...event,
      ...owner, persona: personaOf.get(page) ?? "visitor",
      capture: record.capture, url: sourcePath(page.url()) }) + "\n", { mode: 0o600 });
  };
  page.on("console", (message) => {
    if (message.type() === "error") add("console", message.text(), undefined, message.location());
  });
  page.on("pageerror", (error) => add("pageerror", `pageerror: ${error.message}`, error.stack));
  page.on("response", (response) => {
    if (response.status() >= 400) record.httpErrors.push({ url: response.url(), status: response.status() });
  });
  return record;
}

function sourcePath(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.pathname : "<inline-source>";
  } catch { return "<unknown-source>"; }
}

function safeStack(value: string) {
  return value.replaceAll(PASSWORD, "<redacted>").split("\n").map((line) => {
    if (/\b(?:data|blob|javascript|file):/.test(line)) return "<inline-source>";
    return line.replace(/https?:\/\/[^\s)]+/g, (url) => {
      const position = url.match(/:\d+(?::\d+)?$/)?.[0] ?? "";
      return sourcePath(position ? url.slice(0, -position.length) : url) + position;
    });
  }).join("\n");
}

export async function inCapturePhase<T>(page: Page, phase: string, operation: () => Promise<T>): Promise<T> {
  const record = watched.get(page);
  const previous = record?.phase ?? "journey";
  if (record) record.phase = phase;
  try { return await operation(); } finally { if (record) record.phase = previous; }
}

export const LOADING_NOTICE = 'p[role="status"]:not([data-testid]), p[aria-live]:not([data-testid])';

const QUIET_MS = 1_000;

// A page's own read can put its loading notice back after the first render, so one absent check proves nothing.
export async function settle(page: Page, timeout = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    if (await page.locator(LOADING_NOTICE).count() > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= QUIET_MS) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

const trace = (label: string, phase: string) => { if (process.env.DEBUG_CAPTURE) console.log(`${new Date().toISOString()} capture ${label}: ${phase}`); };

// Mobile Chromium resizes the viewport for a full-page shot and leaves the page scrolled elsewhere.
export async function fullPageShot(page: Page, path: string) {
  const [x, y] = await page.evaluate(() => [window.scrollX, window.scrollY]);
  await inCapturePhase(page, "full-page-screenshot", () => page.screenshot({ path, fullPage: true }));
  await inCapturePhase(page, "restore-scroll", () => page.evaluate(([left, top]) => window.scrollTo(left, top), [x, y]));
}

export async function capture(page: Page, label: string, opts: { expectedStatuses?: number[]; subject?: Locator } = {}) {
  const record = watched.get(page);
  const previous = record?.capture ?? null;
  if (record) record.capture = label;
  try { return await inCapturePhase(page, "capture", () => capturePage(page, label, opts)); } finally {
    if (record) record.capture = previous;
  }
}

async function capturePage(page: Page, label: string, opts: { expectedStatuses?: number[]; subject?: Locator }) {
  const info = test.info();
  trace(label, "start");
  const profile = info.project.metadata as { locale: "de" | "en"; phone: boolean };
  const idle = await inCapturePhase(page, "settle", () => page.waitForLoadState("networkidle", { timeout: 3_000 }).then(() => true, () => false));
  let settled = await inCapturePhase(page, "settle", () => settle(page));
  await inCapturePhase(page, "settle", () => page.evaluate(() => document.fonts?.ready)).catch(() => undefined);
  const persona = personaOf.get(page) ?? "visitor";
  const directory = runPath(`shots/${info.project.name}/${persona}/${slug(info.title)}`);
  mkdirSync(directory, { recursive: true });
  const count = (counters.get(directory) ?? 0) + 1;
  counters.set(directory, count);
  const base = `${directory}/${String(count).padStart(2, "0")}-${label}`;
  trace(label, "idle done");
  for (let attempt = 1; ; attempt++) {
    if (opts.subject) expect(await inCapturePhase(page, "subject", () => showSubject(opts.subject!, page.viewportSize())), `harness: the ${label} capture shows its subject`).toBe(true);
    await inCapturePhase(page, "viewport-screenshot", () => page.screenshot({ path: `${base}.png` }));
    trace(label, "viewport shot");
    await fullPageShot(page, `${base}-full.png`);
    trace(label, "full shot");
    const stillQuiet = await page.locator(LOADING_NOTICE).count() === 0;
    if (stillQuiet || !settled || attempt === 3) { settled = settled && stillQuiet; break; }
    settled = await inCapturePhase(page, "settle", () => settle(page));
  }
  const measured = await inCapturePhase(page, "layout-probe", () => measure(page, profile.locale ?? "de"));
  trace(label, "measured");
  const axe = (await inCapturePhase(page, "axe", () => new AxeBuilder({ page }).analyze())).violations
    .map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length,
      targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")) }));
  const record = watched.get(page) ?? { console: [], consoleEvents: [], httpErrors: [] };
  const httpErrors = record.httpErrors.filter((error) => !(opts.expectedStatuses ?? []).includes(error.status));
  appendFileSync(runPath("metrics.jsonl"), JSON.stringify({
    project: info.project.name, persona, test: info.title, label, url: page.url(), at: new Date().toISOString(),
    shot: `${base}.png`, networkIdle: idle, settled, ...measured, smallTargets: profile.phone ? measured.smallTargets : [],
    axe, console: record.console.splice(0), consoleEvents: record.consoleEvents.splice(0), httpErrors
  }) + "\n");
  record.httpErrors.length = 0;
}
