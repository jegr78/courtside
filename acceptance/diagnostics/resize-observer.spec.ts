import { appendFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { fullPageShot, inCapturePhase, measure, settle, watch } from "../lib/checks";
import { config, runPath } from "../lib/context";
import { openAs } from "../lib/session";

const operations = ["navigation", "viewport-screenshot", "full-page-screenshot", "layout-probe", "axe"] as const;

for (const operation of operations) {
  test(`given an existing administration view, when ${operation} runs in isolation, then its browser observations are retained`, async ({ browser }, info) => {
    // given
    const profile = info.project.metadata as { locale: "de" | "en"; target: { path: string; testId: string } };
    const page = await openAs(browser, "admin");
    try {
      const record = watch(page);
      const source = await (await page.request.get(`${config.baseUrl}/api/source`)).json();
      expect(source.version, "the probe records the configured deployed version").toBe(config.expectedVersion);
      for (let sample = 1; sample <= 3; sample++) {
        const first = record.consoleEvents.length;
        const startedAt = new Date().toISOString();

        // when
        await inCapturePhase(page, "navigation", async () => {
          await page.goto(profile.target.path);
          await expect(page.getByTestId(profile.target.testId)).toBeVisible();
        });
        expect(await inCapturePhase(page, "settle", () => settle(page)), "the view settles before the isolated operation").toBe(true);
        const operationStartedAt = operation === "navigation" ? startedAt : new Date().toISOString();
        const shot = info.outputPath(`${operation}-${sample}.png`);
        await inCapturePhase(page, operation, async () => {
          if (operation === "viewport-screenshot") await page.screenshot({ path: shot });
          else if (operation === "full-page-screenshot") await fullPageShot(page, shot);
          else if (operation === "layout-probe") await measure(page, profile.locale);
          else if (operation === "axe") await new AxeBuilder({ page }).analyze();
        });
        const operationFinishedAt = new Date().toISOString();
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

        // then
        await expect(page.getByTestId(profile.target.testId)).toBeVisible();
        appendFileSync(runPath("resize-observer-probe.jsonl"), JSON.stringify({
          project: info.project.name, path: profile.target.path, operation, sample,
          version: source.version, revision: source.commit, startedAt, operationStartedAt, operationFinishedAt,
          finishedAt: new Date().toISOString(), observations: record.consoleEvents.slice(first)
        }) + "\n", { mode: 0o600 });
      }
    } finally { await page.context().close(); }
  });
}
