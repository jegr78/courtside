import { type Page } from "@playwright/test";
import type { components } from "../src/api/schema";
import { expect, selectPreference, test } from "./fixtures";

test.use({ serviceWorkers: "block" });

async function signIn(page: Page, username: string, locale: "de" | "en") {
  await page.goto("/login");
  await selectPreference(page, "#locale-preference", locale);
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("account-identity")).toHaveText(username);
}

async function openAccount(page: Page) {
  await page.getByTestId("preferences-menu").click();
  await expect(page.getByTestId("account-link")).toHaveCount(1);
  await page.getByTestId("account-link").click();
  await expect(page).toHaveURL(/\/account$/);
}

async function fits(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    "account content introduces no horizontal page overflow").toBe(true);
  for (const id of ["account-identity", "profile-username", "profile-first-name", "profile-last-name", "profile-role"]) {
    const clipped = await page.getByTestId(id).evaluateAll((elements) => elements.some((element) => {
      const rect = element.getBoundingClientRect();
      return element.scrollWidth > element.clientWidth + 1 || rect.left < 0 || rect.right > innerWidth;
    }));
    expect(clipped, `${id} stays readable inside the viewport`).toBe(false);
  }
}

for (const locale of ["de", "en"] as const) {
  test(`given a signed-in member in ${locale}, when the account menu and security shortcut are used, then identity and both sections remain reachable by keyboard`, async ({ page }, info) => {
    // given
    await signIn(page, "doe.jane", locale);
    await expect(page.getByTestId("preferences-menu")).toHaveAccessibleName(
      `${locale === "de" ? "Konto und Darstellung" : "Account and appearance"} doe.jane`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath(`account-control-${locale}.png`),
      style: "[data-testid='pwa-registration-warning'] { visibility: hidden; }" });

    // when
    await page.getByTestId("preferences-menu").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(page.locator("#locale-preference")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#theme-preference")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("account-link")).toBeFocused();
    await expect(page.getByTestId("account-link")).toHaveText(locale === "de" ? "Mein Konto" : "My account");
    await page.keyboard.press("Enter");

    // then
    await expect(page.getByTestId("account-title")).toBeFocused();
    await expect(page.getByTestId("profile-first-name")).toHaveText("Jane");
    await expect(page.getByTestId("profile-last-name")).toHaveText("Doe");
    await expect(page.getByTestId("profile-role")).toHaveText(locale === "de" ? "Mitglied" : "Member");
    await expect(page.getByTestId("account-security-view")).toBeVisible();
    expect(await page.getByTestId("primary-navigation-bar").getByRole("link").count()).toBeLessThanOrEqual(4);
    await page.goto("/account/security");
    const heading = page.getByTestId("account-security-title");
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    expect(await heading.evaluate((element) => element.matches(":focus-visible")), "the direct-entry focus target is visible").toBe(true);
    await expect(page.getByTestId("current-password")).toBeVisible();
    await expect(page.getByTestId("end-current-session")).toHaveCount(1);
    await page.getByTestId("end-current-session").click();
    await expect(page.getByTestId("account-identity")).toHaveCount(0);
    await expect(page.getByTestId("account-profile")).toHaveCount(0);
  });

  test(`given long account values in ${locale}, when desktop and phone widths render them, then the profile and sign-out stay readable and reachable`, async ({ page }, info) => {
    // given
    await signIn(page, "doe.jane", locale);
    const username = "jane.doe." + "longaccount".repeat(5);
    const firstName = "Jane Mary ".repeat(8).trim();
    const lastName = "Doe Roe ".repeat(8).trim();
    const current = await page.evaluate(async () => {
      const response = await fetch("/api/session", { cache: "no-store" });
      return await response.json() as components["schemas"]["SessionStatus"];
    });
    expect(current.authenticated).toBe(true);
    await page.route("**/api/session", (route) => route.fulfill({ json: { ...current, username, firstName, lastName,
      roles: ["MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER", "TREASURER", "ADMIN"] } }));
    await page.goto("/account");
    await expect(page.getByTestId("profile-username")).toHaveText(username);
    const widths = info.project.use.isMobile ? [320, 375, 734] : [1440];

    // when / then
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 734 ? 343 : 900 });
      await fits(page);
      await page.getByTestId("preferences-menu").click();
      const logout = page.getByTestId("logout");
      await logout.scrollIntoViewIfNeeded();
      await expect(logout).toBeInViewport();
      await page.getByTestId("preferences-menu").click();
      await page.screenshot({ path: info.outputPath(`account-${locale}-${width}.png`), fullPage: true,
        style: "[data-testid='pwa-registration-warning'] { visibility: hidden; }" });
    }
    await expect(page.getByTestId("profile-first-name")).toHaveText(firstName);
    await expect(page.getByTestId("profile-last-name")).toHaveText(lastName);
    await expect(page.getByTestId("profile-role")).toHaveCount(7);
    await page.screenshot({ path: info.outputPath(`account-${locale}.png`), fullPage: true,
      style: "[data-testid='pwa-registration-warning'] { visibility: hidden; }" });
    await page.unroute("**/api/session");
    await page.getByTestId("preferences-menu").click();
    await page.getByTestId("logout").click();
    await expect(page.getByTestId("account-identity")).toHaveCount(0);
    await expect(page.getByTestId("account-profile")).toHaveCount(0);
  });

  test(`given non-member and multi-role accounts in ${locale}, when each opens its own profile, then actual assignments replace the previous account`, async ({ page }) => {
    // given
    const accounts = [
      { username: "sport.major", firstName: "Mary", lastName: "Major", roles: [locale === "de" ? "Sportwart" : "Sport director"] },
      { username: "trainer.doe", firstName: "John", lastName: "Doe", roles: [locale === "de" ? "Mitglied" : "Member", "Trainer"] },
      { username: "configuration-admin", firstName: "Richard", lastName: "Miles", roles: ["Administrator"] }
    ];

    // when / then
    for (const account of accounts) {
      await signIn(page, account.username, locale);
      if (account.username === "configuration-admin") {
        await page.goto("/admin");
        await expect(page.getByTestId("admin-shell")).toBeVisible();
        await expect(page.getByTestId("account-identity")).toHaveText(account.username);
      }
      await openAccount(page);
      await expect(page.getByTestId("profile-username")).toHaveText(account.username);
      await expect(page.getByTestId("profile-first-name")).toHaveText(account.firstName);
      await expect(page.getByTestId("profile-last-name")).toHaveText(account.lastName);
      expect((await page.getByTestId("profile-role").allTextContents()).sort()).toEqual([...account.roles].sort());
      await page.getByTestId("preferences-menu").click();
      await page.getByTestId("logout").click();
      await expect(page.getByTestId("account-identity")).toHaveCount(0);
      await expect(page.getByTestId("account-profile")).toHaveCount(0);
    }
  });
}
