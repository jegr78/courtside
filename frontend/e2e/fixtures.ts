import { expect, test as base, type Browser, type BrowserContext, type Metadata, type Page } from "@playwright/test";
import { journeyInstant, startJourneyService, type JourneyService } from "./global-setup";

// Every browser is drawn from the pinned image, so a run compares like for like anywhere.
// A project on the plain origin covers the club that serves Courtside without TLS.
const usesPlainOrigin = (project: { metadata: Metadata }): boolean =>
  project.metadata.plainOrigin === true;

interface WorkerFixtures {
  journeyService: JourneyService;
}

interface TestFixtures {
  resetJourney: void;
}

export async function journeyContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  await pinJourneyClock(context);
  return context;
}

async function pinJourneyClock(context: BrowserContext): Promise<void> {
  // Date.now stands still with it.
  await context.clock.setFixedTime(new Date(journeyInstant));
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  journeyService: [async ({ browserName }, provide) => {
    void browserName;
    const service = await startJourneyService();
    await provide(service);
    await service.stop();
  }, { scope: "worker" }],
  browser: [async ({ playwright, browserName, journeyService }, provide) => {
    const pinned = await playwright[browserName].connect(await journeyService.pinnedBrowser(browserName));
    await provide(pinned);
    await pinned.close();
  }, { scope: "worker" }],
  baseURL: async ({ journeyService }, provide, testInfo) => {
    await provide(usesPlainOrigin(testInfo.project)
      ? journeyService.plainBaseURL
      : journeyService.baseURL);
  },
  context: async ({ context }, provide) => {
    await pinJourneyClock(context);
    await provide(context);
  },
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
