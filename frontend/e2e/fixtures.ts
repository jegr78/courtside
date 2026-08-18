import { expect, test as base, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { journeyInstant, startJourneyService, type JourneyService } from "./global-setup";

// WebKit and the pixel suite draw in the pinned image: WebKit so no runner needs its system
// libraries, the pixel suite so one reviewed baseline holds on every machine.
const PINNED_PROJECTS = new Set(["visual", "webkit-accessibility", "webkit-core"]);

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
  browser: [async ({ playwright, browserName, journeyService }, provide, workerInfo) => {
    if (!PINNED_PROJECTS.has(workerInfo.project.name)) {
      // Delegating to Playwright's own fixture would launch a local browser for the pinned
      // projects too, which is the installation this exists to avoid.
      const local = await playwright[browserName].launch(workerInfo.project.use.launchOptions);
      await provide(local);
      await local.close();
      return;
    }
    const pinned = await playwright[browserName].connect(await journeyService.pinnedBrowser());
    await provide(pinned);
    await pinned.close();
  }, { scope: "worker" }],
  baseURL: async ({ journeyService }, provide, testInfo) => {
    await provide(PINNED_PROJECTS.has(testInfo.project.name)
      ? await journeyService.containerBaseURL()
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
