import { runPath } from "./context";
import { appendFileSync, mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { test, type Page } from "@playwright/test";
import { layoutProbe, layoutProbeArguments } from "./layout-probe.mjs";

export async function measure(page: Page, locale: "de" | "en") {
  return page.evaluate(layoutProbe, layoutProbeArguments(locale));
}

type Watched = { console: string[]; httpErrors: { url: string; status: number }[] };
const watched = new WeakMap<Page, Watched>();
const personaOf = new WeakMap<Page, string>();
const counters = new Map<string, number>();

export function setPersona(page: Page, key: string) { personaOf.set(page, key); }

const slug = (title: string) => title.replace(/^given |^when /, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 40).replace(/-$/, "");

export function watch(page: Page) {
  const record: Watched = { console: [], httpErrors: [] };
  watched.set(page, record);
  page.on("console", (message) => { if (message.type() === "error") record.console.push(message.text()); });
  page.on("pageerror", (error) => record.console.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) record.httpErrors.push({ url: response.url(), status: response.status() });
  });
}

const trace = (label: string, phase: string) => { if (process.env.DEBUG_CAPTURE) console.log(`${new Date().toISOString()} capture ${label}: ${phase}`); };

export async function capture(page: Page, label: string, opts: { expectedStatuses?: number[] } = {}) {
  const info = test.info();
  trace(label, "start");
  const profile = info.project.metadata as { locale: "de" | "en"; phone: boolean };
  const idle = await page.waitForLoadState("networkidle", { timeout: 3_000 }).then(() => true, () => false);
  const settled = await page.locator('p[role="status"]:not([data-testid])').first().waitFor({ state: "detached", timeout: 10_000 }).then(() => true, () => false);
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  const persona = personaOf.get(page) ?? "visitor";
  const directory = runPath(`shots/${info.project.name}/${persona}/${slug(info.title)}`);
  mkdirSync(directory, { recursive: true });
  const count = (counters.get(directory) ?? 0) + 1;
  counters.set(directory, count);
  const base = `${directory}/${String(count).padStart(2, "0")}-${label}`;
  trace(label, "idle done");
  await page.screenshot({ path: `${base}.png` });
  trace(label, "viewport shot");
  await page.screenshot({ path: `${base}-full.png`, fullPage: true });
  trace(label, "full shot");
  const measured = await measure(page, profile.locale ?? "de");
  trace(label, "measured");
  const axe = (await new AxeBuilder({ page }).analyze()).violations
    .map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length,
      targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")) }));
  const record = watched.get(page) ?? { console: [], httpErrors: [] };
  const httpErrors = record.httpErrors.filter((error) => !(opts.expectedStatuses ?? []).includes(error.status));
  appendFileSync(runPath("metrics.jsonl"), JSON.stringify({
    project: info.project.name, persona, test: info.title, label, url: page.url(), at: new Date().toISOString(),
    shot: `${base}.png`, networkIdle: idle, settled, ...measured, smallTargets: profile.phone ? measured.smallTargets : [],
    axe, console: record.console.splice(0), httpErrors
  }) + "\n");
  record.httpErrors.length = 0;
}
