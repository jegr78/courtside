import { readFileSync } from "node:fs";
import { type Page, type TestInfo } from "@playwright/test";
import { expect, selectPreference, test } from "./fixtures";

// The guides are read in the light theme on a page column, and the instance answers in German
// unless somebody says otherwise, so both are chosen here rather than inherited.
test.use({ viewport: { width: 1280, height: 800 } });

interface Capture {
  readonly name: string;
  readonly surface: string;
  readonly pages: Record<string, string>;
}

const catalogue = JSON.parse(readFileSync(
  new URL("../../site/screenshots/captures.json", import.meta.url), "utf8")) as {
    locales: string[];
    captures: Capture[];
  };

// The project decides the language, so one run produces both and neither depends on an
// environment variable somebody has to remember.
function localeOf(info: TestInfo): string {
  return info.project.name.replace(/^guides-/, "");
}

const drivers: Record<string, (page: Page, visualDate: string) => Promise<void>> = {
  "court-plan": async (page, visualDate) => {
    await page.goto("/");
    await expect(page.getByTestId("public-club-name")).toBeVisible();
    await selectVisualDate(page, visualDate);
  },
  "booking-dialog": async (page, visualDate) => {
    await selectVisualDate(page, visualDate);
    await page.locator('[data-testid="free-slot"][data-court-number="1"][data-slot="12:00"]').click();
    await expect(page.getByTestId("booking-dialog")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  "my-bookings": async (page) => {
    await page.getByTestId("booking-submit").click();
    await expect(page.getByTestId("booking-dialog").locator("[data-code]")).toBeVisible();
    await page.getByTestId("booking-close").click();
    await page.getByTestId("my-bookings-link").click();
    await expect(page.getByTestId("my-bookings-page")).toBeVisible();
  },
  "admin-setup": async (page) => {
    await page.getByTestId("administration-link").click();
    await expect(page.getByTestId("setup-progress")).toBeVisible();
  },
  "club-appearance": async (page) => {
    await page.getByTestId("admin-configuration-link").click();
    await expect(page.getByTestId("save-club-config")).toBeVisible();
  },
  "admin-roster": async (page) => {
    await page.goto("/admin/roster");
    await expect(page.locator('[data-testid^="roster-row-"]').first()).toBeVisible();
  }
};

test("every member surface the guides show is captured", async ({ page, journeyService }, info) => {
  // given
  await prepare(page, localeOf(info));

  // when / then
  await capture(page, "court-plan", journeyService.visualDate);
  await signIn(page, "doe.jane");
  await capture(page, "booking-dialog", journeyService.visualDate);
  await capture(page, "my-bookings", journeyService.visualDate);
});

test("every administration surface the guides show is captured", async ({ page, journeyService }, info) => {
  // given
  await prepare(page, localeOf(info));
  await signIn(page, "configuration-admin");

  // when / then
  await capture(page, "admin-setup", journeyService.visualDate);
  await capture(page, "club-appearance", journeyService.visualDate);
  await capture(page, "admin-roster", journeyService.visualDate);
});

async function prepare(page: Page, locale: string): Promise<void> {
  await page.goto("/");
  await selectPreference(page, "#locale-preference", locale);
  await selectPreference(page, "#theme-preference", "light");
}

async function capture(page: Page, name: string, visualDate: string): Promise<void> {
  const declared = catalogue.captures.find((entry) => entry.name === name);
  if (declared === undefined) throw new Error(`No catalogue entry for ${name}`);
  await drivers[name](page, visualDate);
  const surface = page.getByTestId(declared.surface);
  await surface.page().evaluate(() => document.fonts.ready);
  await expect(surface).toHaveScreenshot(`${name}.png`, { animations: "disabled", caret: "hide" });
}

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
}

async function selectVisualDate(page: Page, date: string): Promise<void> {
  await expect(page.getByTestId("week-grid")).toBeVisible();
  const day = page.getByTestId(`day-selector-${date}`);
  if (await day.count() === 0) {
    await page.getByTestId("week-next").click();
  }
  await day.click();
}
