import { join } from "node:path";
import { expect, test as base, type Browser, type BrowserContext, type BrowserContextOptions, type Metadata, type Page } from "@playwright/test";
import { journeyInstant, type JourneyService, type JourneyStart } from "./global-setup";
import { connectJourneyService, type JourneyControlReference } from "./journey-control";
import { diagnoseUnexpectedBrowserTest, observeBrowserDisconnect } from "./browser-diagnostics";
import { browserFixtureScope, browserIsolationVariant } from "./browser-isolation";
import { clubLanguage } from "./club-language";

// Every browser is drawn from the pinned image, so a run compares like for like anywhere.
// A project on the plain origin covers the club that serves Courtside without TLS.
const usesPlainOrigin = (project: { metadata: Metadata }): boolean =>
  project.metadata.plainOrigin === true;

interface WorkerFixtures {
  journeyService: JourneyService;
  pinnedBrowser: Browser;
}

// The catalogue's two tiers and its two languages are project options, so a journey reads which
// language it walks in rather than deciding one.
export type JourneyLanguage = "de" | "en";

export interface JourneyOptions {
  language: JourneyLanguage;
  start: JourneyStart;
}

interface TestFixtures {
  browserLifecycle: void;
  failureDiagnostics: void;
  resetJourney: void;
}

export async function journeyContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext(asTheProjectDeclares());
  await pinJourneyClock(context);
  return context;
}

// The runner applies a project's device and its recording to the context it owns; this one is
// created here, so a phone journey has to ask for the screen and the touch the project declared.
function asTheProjectDeclares(): BrowserContextOptions {
  try {
    const info = base.info();
    const { userAgent, viewport, deviceScaleFactor, isMobile, hasTouch, video } = info.project.use;
    // Without a size the recording is fitted into 800x800, which halves a desktop viewport.
    const recordVideo = video === "on" ? { dir: info.outputDir, size: viewport ?? undefined } : undefined;
    return declared({ userAgent, viewport, deviceScaleFactor, isMobile, hasTouch, recordVideo });
  } catch {
    return {};
  }
}

// A key that is present and undefined is still an answer: the runner stops applying its own option
// for it, so a spec that asked for a viewport with test.use would silently lose it.
function declared(options: BrowserContextOptions): BrowserContextOptions {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
}

const browserScope = browserFixtureScope(browserIsolationVariant());
let testPosition = 0;

async function pinJourneyClock(context: BrowserContext): Promise<void> {
  // Date.now stands still with it.
  await context.clock.setFixedTime(new Date(journeyInstant));
}

// A project that declares a locale is published in that language, so its browser process is started
// in it too: the date, time and file controls follow the process and not the context.
async function pinnedBrowserFixture(
  { playwright, browserName, journeyService }: {
    playwright: typeof import("playwright-core");
    browserName: "chromium" | "firefox" | "webkit";
    journeyService: JourneyService;
  },
  provide: (browser: Browser) => Promise<void>,
  info: { project: { use: { locale?: string } } }
): Promise<void> {
  const pinned = await playwright[browserName]
    .connect(await journeyService.pinnedBrowser(browserName, info.project.use.locale));
  const finishDiagnostics = observeBrowserDisconnect(pinned,
    () => journeyService.browserDiagnostics(browserName, "browser-disconnected"));
  try {
    await provide(pinned);
  } finally {
    try {
      await finishDiagnostics();
    } finally {
      try {
        if (pinned.isConnected()) await pinned.close();
      } finally {
        await journeyService.releasePinnedBrowser(browserName);
      }
    }
  }
}

export const test = base.extend<TestFixtures & JourneyOptions, WorkerFixtures>({
  language: ["de", { option: true }],
  start: ["seeded", { option: true }],
  journeyService: [async ({ browserName }, provide) => {
    void browserName;
    const serialized = process.env.COURTSIDE_JOURNEY_CONTROL;
    if (!serialized) throw new Error("Global setup did not publish the journey control endpoint");
    await provide(connectJourneyService(JSON.parse(serialized) as JourneyControlReference));
  }, { scope: "worker" }],
  pinnedBrowser: [pinnedBrowserFixture, { scope: browserScope }] as never,
  baseURL: async ({ journeyService }, provide, testInfo) => {
    await provide(usesPlainOrigin(testInfo.project)
      ? journeyService.plainBaseURL
      : journeyService.baseURL);
  },
  context: async ({ pinnedBrowser }, provide, testInfo) => {
    const context = await journeyContext(pinnedBrowser);
    try {
      await provide(context);
    } finally {
      const recordings = context.pages().map((open) => open.video());
      await context.close();
      for (const [index, recording] of recordings.entries()) {
        if (!recording) continue;
        const path = join(testInfo.outputDir, `journey-${index + 1}.webm`);
        await recording.saveAs(path);
        await testInfo.attach(`journey-${index + 1}`, { path, contentType: "video/webm" });
      }
    }
  },
  browserLifecycle: [async ({ pinnedBrowser, browserName, journeyService }, provide, testInfo) => {
    void pinnedBrowser;
    const position = ++testPosition;
    await journeyService.recordBrowserTest(browserName, testInfo.project.name, position, "start");
    try {
      await provide();
    } finally {
      await journeyService.recordBrowserTest(browserName, testInfo.project.name, position, "end");
    }
  }, { auto: true }],
  failureDiagnostics: [async ({ pinnedBrowser, browserName, journeyService, page }, provide, testInfo) => {
    let pageCrashed = false;
    const crashed = () => { pageCrashed = true; };
    page.on("crash", crashed);
    await provide();
    page.removeListener("crash", crashed);
    if (!pinnedBrowser.isConnected()) return;
    await diagnoseUnexpectedBrowserTest({
      status: testInfo.status,
      expectedStatus: testInfo.expectedStatus,
      errors: testInfo.errors,
      pageCrashed,
      browserConnected: true
    }, (reason) => journeyService.browserDiagnostics(browserName, reason, {
      title: testInfo.title,
      projectName: testInfo.project.name,
      status: testInfo.status ?? "unknown",
      errors: testInfo.errors.map((error) => error.message ?? error.value ?? "")
    }));
  }, { auto: true }],
  // A project published in a language shows a club that speaks it, because a card, a rule set and
  // a membership type are rows the club names once and not text the reader's browser translates.
  resetJourney: [async ({ journeyService, start }, provide, info) => {
    await journeyService.reset(start, clubLanguage(info.project.use.locale));
    await provide();
  }, { auto: true }]
});

export async function selectJourneyDate(page: Page, visualDate: string): Promise<void> {
  await expect(page.getByTestId("week-grid")).toBeVisible();
  const day = page.getByTestId(`day-selector-${visualDate}`);
  if (await day.count() === 0) {
    await page.locator('[data-testid="week-next"]:visible, [data-testid="mobile-week-next"]:visible').click();
  }
  await day.click();
}

// The seeded bookings lie on the visual date, so a page that reads today needs its morning.
export async function onTheVisualDay(page: Page, visualDate: string): Promise<void> {
  await page.clock.setFixedTime(new Date(`${visualDate}T06:00:00Z`));
}

export async function backAtTheJourneyInstant(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(journeyInstant));
}

// The overview renders every card's loading line in its first frame, so none left means all answered.
export async function expectAdministrationOverview(page: Page): Promise<void> {
  const overview = page.getByTestId("admin-overview-view");
  await expect(overview).toBeVisible();
  await expect(overview.getByTestId("overview-setup")).toBeVisible();
  await expect(overview.getByRole("status")).toHaveCount(0);
  await expect(overview.getByTestId("load-failure")).toHaveCount(0);
}

export async function selectPreference(page: Page, selector: "#locale-preference" | "#theme-preference", value: string): Promise<void> {
  const menu = page.getByTestId("preferences-menu");
  await menu.click();
  await page.locator(selector).selectOption(value);
  await menu.click();
}

export { expect };
