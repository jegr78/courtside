import { runPath } from "./context";
import { appendFileSync, mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { test, type Page } from "@playwright/test";

const GERMAN = /\b(und|nicht|für|buchen|Platz|Plätze|Mitglied|Buchung|Buchungen|Anmelden|Abmelden|Einstellungen|Woche|heute|Uhr|speichern|abbrechen|zurück|Verein)\b|[äöüß]/i;
const KEY = /(^|[^@\w.\/-])([a-z][a-zA-Z]+(?:\.[a-zA-Z0-9]+){1,})(?![\w\/@-])/g;
const TLD = /\.(org|com|net|de|io|dev|app|eu|ts\.net)$/;

export async function measure(page: Page, locale: "de" | "en") {
  return page.evaluate(({ locale, german, key, tld }) => {
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;
    const describe = (element: Element) =>
      `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.getAttribute("data-testid") ? `[data-testid="${element.getAttribute("data-testid")}"]` : ""}`;
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const shown = typeof element.checkVisibility === "function"
        ? element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
      return shown && style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
    };
    const insideScroller = (element: Element) => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden" || overflowX === "clip") return true;
      }
      return false;
    };
    const all = [...document.body.querySelectorAll("*")].filter(visible);
    const overflow = all.filter((element) => {
      const box = element.getBoundingClientRect();
      return (box.right > width + 1 || box.left < -1) && !insideScroller(element);
    }).map((element) => ({ selector: describe(element), left: Math.round(element.getBoundingClientRect().left), right: Math.round(element.getBoundingClientRect().right) }));
    const modal = [...document.querySelectorAll('[aria-modal="true"], dialog[open]')].filter(visible).at(-1);
    const clippedAway = (element: Element, x: number, y: number) => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflowX === "visible" && getComputedStyle(parent).overflowY === "visible") continue;
        const clip = parent.getBoundingClientRect();
        if (x < clip.left || x > clip.right || y < clip.top || y > clip.bottom) return true;
      }
      return false;
    };
    const occluded = [...(modal ?? document).querySelectorAll("button, a[href], input, select, [role=button]")]
      .filter(visible).flatMap((element) => {
        const box = element.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        if (x < 0 || y < 0 || x > width || y > height || clippedAway(element, x, y)) return [];
        const top = document.elementFromPoint(x, y);
        if (!top || element.contains(top) || top.contains(element)) return [];
        const label = element.closest("label") ?? (element.id ? document.querySelector(`label[for="${element.id}"]`) : null);
        if (label?.contains(top)) return [];
        return [{ selector: describe(element), by: describe(top) }];
      });
    const truncated = all.filter((element) => element.children.length === 0 && element.textContent?.trim()
      && element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX !== "visible")
      .map((element) => ({ selector: describe(element), text: element.textContent!.trim().slice(0, 60) }));
    const smallTargets = [...document.querySelectorAll("button, a[href], input, select")].filter(visible)
      .filter((element) => { const box = element.getBoundingClientRect(); return box.width < 44 || box.height < 44; })
      .map((element) => describe(element));
    const text = document.body.innerText;
    const i18nKeys = [...new Set([...text.matchAll(new RegExp(key, "g"))].map((match) => match[2])
      .filter((candidate) => !new RegExp(tld).test(candidate) && /[A-Z]|\..+\./.test(candidate)))];
    const germanOnEn = locale === "en"
      ? text.split("\n").filter((line) => new RegExp(german, "i").test(line)).slice(0, 20) : [];
    return { documentOverflow: document.documentElement.scrollWidth > width + 1, overflow, occluded, truncated, smallTargets, i18nKeys, germanOnEn };
  }, { locale, german: GERMAN.source, key: KEY.source, tld: TLD.source });
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
