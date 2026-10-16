import { expect, test } from "../../fixtures";
import { activate, openTheApplication, reachAdministration, rewrite, signIn, walks } from "../../journey-walking";

test("given a board that wants to know who turns up, when they switch attendance on with a release time and read a member's no-shows, then both are settings and records the board keeps in the product",
  walks("session-and-own-account", "attendance-and-no-shows"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await expect(page.getByTestId("admin-shell")).toBeVisible();

    // when — attendance is switched on and an unattended court is freed after 20 minutes
    await reachAdministration(page, "admin-deadlines-link");
    await expect(page.getByTestId("attendance-policy")).toBeVisible();
    if (!await page.getByTestId("attendance-enabled").isChecked()) await activate(page.getByTestId("attendance-enabled"));
    await rewrite(page.getByTestId("attendance-release-minutes"), "20");
    if (await page.getByTestId("save-attendance-policy").isVisible()) {
      await activate(page.getByTestId("save-attendance-policy"));
      await expect(page.getByTestId("attendance-policy-saved")).toBeVisible();
    }

    // then
    await expect(page.getByTestId("save-attendance-policy")).toBeHidden();
    await expect(page.getByTestId("attendance-release-minutes")).toHaveValue("20");

    // when — the board opens a member and reads what still counts against them
    await reachAdministration(page, "admin-roster-link");
    await expect(page.getByTestId("admin-roster-view")).toBeVisible();
    await activate(page.locator('[data-testid^="person-link-"]').first());

    // then
    await expect(page.getByTestId("admin-person-view")).toBeVisible();
    await expect(page.getByTestId("person-no-shows")
      .or(page.getByTestId("account-needs-address")).or(page.getByTestId("create-account")).first()).toBeVisible();

    // when — and switches it off again, which frees nothing and counts nothing
    await reachAdministration(page, "admin-deadlines-link");
    await expect(page.getByTestId("attendance-policy")).toBeVisible();
    if (await page.getByTestId("attendance-enabled").isChecked()) {
      await activate(page.getByTestId("attendance-enabled"));
      await activate(page.getByTestId("save-attendance-policy"));
      await expect(page.getByTestId("attendance-policy-saved")).toBeVisible();
    }

    // then
    await expect(page.getByTestId("attendance-release-minutes")).toBeDisabled();
  });
