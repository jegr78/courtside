import { expect, test } from "../../fixtures";
import { activate, openTheApplication, reachAdministration, signIn, walks } from "../../journey-walking";

test("given a treasurer who settles the year's guest fees, when the board opens them from the export and downloads them, then the year's list is a file",
  walks("session-and-own-account", "guest-fee-report"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await expect(page.getByTestId("admin-shell")).toBeVisible();

    // when
    await reachAdministration(page, "admin-export-link");
    await activate(page.getByTestId("guest-fees-open"));
    await expect(page.getByTestId("admin-guest-fees-view")).toBeVisible();
    await expect(page.getByTestId("guest-fees-report")).toBeVisible();
    const saved = page.waitForEvent("download");
    await activate(page.getByTestId("guest-fees-download"));

    // then
    expect((await saved).suggestedFilename()).toMatch(/^guest-fees-\d{4}-01-01-\d{4}-12-31\.csv$/);
  });
