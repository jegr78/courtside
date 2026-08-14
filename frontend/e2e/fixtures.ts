import { expect, test as base } from "@playwright/test";
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

export { expect };
