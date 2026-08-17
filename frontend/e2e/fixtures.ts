import { expect, test as base, type Page } from "@playwright/test";
import { startJourneyService, type JourneyService } from "./global-setup";

interface WorkerFixtures {
  journeyService: JourneyService;
}

interface TestFixtures {
  resetJourney: void;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  journeyService: [async ({ browserName }, provide) => {
    void browserName;
    const service = await startJourneyService();
    await provide(service);
    await service.stop();
  }, { scope: "worker" }],
  baseURL: async ({ journeyService }, provide) => {
    await provide(journeyService.baseURL);
  },
  resetJourney: [async ({ journeyService }, provide) => {
    await journeyService.reset();
    process.env.COURTSIDE_VISUAL_JOURNEY_DATE = journeyService.visualDate;
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
