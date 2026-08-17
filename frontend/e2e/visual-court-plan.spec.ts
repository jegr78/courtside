import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const locales = ["de", "en"] as const;
const viewports = [
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "tablet-1024x768", width: 1024, height: 768 },
  { name: "desktop-1440x1000", width: 1440, height: 1000 }
] as const;

for (const locale of locales) {
  for (const viewport of viewports) {
    test(`${locale} court-plan journey at ${viewport.name}`, async ({ page }) => {
      // given
      await page.setViewportSize(viewport);
      await page.goto("/login");
      await page.locator("#locale-preference").selectOption(locale);
      await page.locator("#theme-preference").selectOption("dark");

      // then
      await captureFullPage(page, locale, viewport.name, "01-login-dark");

      // when
      await page.locator("#theme-preference").selectOption("light");

      // then
      await captureFullPage(page, locale, viewport.name, "02-login-light");

      // when
      await page.locator("#theme-preference").selectOption("dark");
      await page.getByTestId("username").fill("doe.jane");
      await page.getByTestId("password").fill("temporary-password");
      await page.getByTestId("login-submit").click();
      await expect(page.getByTestId("court-plan-view")).toBeVisible();
      const date = visualJourneyDate();
      if (viewport.width < 1024) {
        await page.getByTestId("selected-date").fill(date);
      } else {
        await expect(page.getByTestId("week-grid")).toBeVisible();
        const day = page.getByTestId(`day-selector-${date}`);
        if (await day.count() === 0) {
          await page.getByTestId("week-next").click();
        }
        await day.click();
      }

      // then
      await expect(page.locator('[data-testid^="court-column-"]')).toHaveCount(4);
      await expect(page.getByTestId("own-allocation")).toHaveCount(1);
      await expect(page.locator('[data-state="occupied"]')).toHaveCount(1);
      await expect(page.locator('[data-card-color="#34584A"]')).toHaveCount(1);
      await expect(page.locator('[data-card-color="#3A4A5C"]')).toHaveCount(1);
      await expect(page.locator('[data-card-color="#E8DDD4"]')).toHaveCount(1);
      const targetSlot = page.locator('[data-testid="free-slot"][data-court-number="1"][data-slot="12:00"][data-state="free"]');
      await expect(targetSlot).toBeVisible();
      await page.getByTestId("week-grid").evaluate((plan) => plan.scrollTo(0, 0));
      await captureFullPage(page, locale, viewport.name, "03-court-plan-dark");

      if (viewport.width < 1024) {
        for (const court of [2, 3, 4]) {
          await page.getByTestId(`court-selector-${court}`).click();
          await captureFullPage(page, locale, viewport.name, `04-court-${court}-dark`);
        }
        await page.getByTestId("court-selector-1").click();
      }

      // when
      await page.locator("#theme-preference").selectOption("light");

      // then
      await captureFullPage(page, locale, viewport.name, "05-court-plan-light");

      // when
      await targetSlot.click();
      await expect(page.getByTestId("booking-dialog")).toBeVisible();

      // then
      await expect(page.getByTestId("booking-close")).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId("booking-submit")).toBeInViewport({ ratio: 1 });
      const lightDialog = await captureViewport(page, locale, viewport.name, "06-booking-dialog-light");
      expect(pngDimensions(lightDialog)).toEqual({ width: viewport.width, height: viewport.height });

      // when
      await page.locator("#theme-preference").selectOption("dark");

      // then
      const darkDialog = await captureViewport(page, locale, viewport.name, "07-booking-dialog-dark");
      expect(pngDimensions(darkDialog)).toEqual({ width: viewport.width, height: viewport.height });
    });
  }
}

function captureFullPage(page: Page, locale: string, viewport: string, step: string): Promise<Buffer> {
  return capture(page, locale, viewport, step, true);
}

function captureViewport(page: Page, locale: string, viewport: string, step: string): Promise<Buffer> {
  return capture(page, locale, viewport, step, false);
}

async function capture(page: Page, locale: string, viewport: string, step: string, fullPage: boolean): Promise<Buffer> {
  const directory = resolve("test-results", "visual-journeys", locale, viewport);
  await mkdir(directory, { recursive: true });
  return page.screenshot({ path: resolve(directory, `${step}.png`), fullPage, animations: "disabled" });
}

function pngDimensions(image: Buffer): { width: number; height: number } {
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

function visualJourneyDate(): string {
  const date = process.env.COURTSIDE_VISUAL_JOURNEY_DATE;
  if (!date) throw new Error("The visual journey date was not provided by global setup");
  return date;
}
