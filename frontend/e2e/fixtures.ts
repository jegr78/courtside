import { expect, test as base, type Browser, type BrowserContext, type Metadata, type Page } from "@playwright/test";
import { journeyInstant, type JourneyService } from "./global-setup";
import { connectJourneyService, type JourneyControlReference } from "./journey-control";
import { diagnoseUnexpectedBrowserTest, observeBrowserDisconnect } from "./browser-diagnostics";
import { browserFixtureScope, browserIsolationVariant } from "./browser-isolation";

// Every browser is drawn from the pinned image, so a run compares like for like anywhere.
// A project on the plain origin covers the club that serves Courtside without TLS.
const usesPlainOrigin = (project: { metadata: Metadata }): boolean =>
  project.metadata.plainOrigin === true;

interface WorkerFixtures {
  journeyService: JourneyService;
  pinnedBrowser: Browser;
}

interface TestFixtures {
  browserLifecycle: void;
  failureDiagnostics: void;
  resetJourney: void;
}

export async function journeyContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  await pinJourneyClock(context);
  return context;
}

const browserScope = browserFixtureScope(browserIsolationVariant());
let testPosition = 0;

async function pinJourneyClock(context: BrowserContext): Promise<void> {
  // Date.now stands still with it.
  await context.clock.setFixedTime(new Date(journeyInstant));
}

async function pinnedBrowserFixture(
  { playwright, browserName, journeyService }: {
    playwright: typeof import("playwright-core");
    browserName: "chromium" | "firefox" | "webkit";
    journeyService: JourneyService;
  },
  provide: (browser: Browser) => Promise<void>
): Promise<void> {
  const pinned = await playwright[browserName].connect(await journeyService.pinnedBrowser(browserName));
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

export const test = base.extend<TestFixtures, WorkerFixtures>({
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
  context: async ({ pinnedBrowser }, provide) => {
    const context = await journeyContext(pinnedBrowser);
    try {
      await provide(context);
    } finally {
      await context.close();
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
  resetJourney: [async ({ journeyService }, provide) => {
    await journeyService.reset();
    await provide();
  }, { auto: true }]
});

export async function selectJourneyDate(page: Page, visualDate: string): Promise<void> {
  await expect(page.getByTestId("week-grid")).toBeVisible();
  const day = page.getByTestId(`day-selector-${visualDate}`);
  if (await day.count() === 0) await page.getByTestId("week-next").click();
  await day.click();
}

export { expect };
