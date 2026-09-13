import { expect, test } from "../../fixtures";
import { activate, openTheApplication, signIn, walks } from "../../journey-walking";

test("given a member who asks what the club holds about them, when the board exports the club's data and then that one person's record, then both are files the board can hand over",
  walks("session-and-own-account", "administrative-export-and-subject-access"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await expect(page.getByTestId("admin-shell")).toBeVisible();

    // when — the club's own records first
    await activate(page.getByTestId("admin-export-link"));
    await expect(page.getByTestId("admin-export-view")).toBeVisible();
    const rosterSaved = page.waitForEvent("download");
    await activate(page.getByTestId("roster-export-download"));

    // then
    expect((await rosterSaved).suggestedFilename()).toMatch(/^roster-\d{4}-\d{2}-\d{2}\.csv$/);

    // when — and then the one person who asked
    await activate(page.getByTestId("admin-roster-link"));
    await expect(page.getByTestId("admin-roster-view")).toBeVisible();
    await activate(page.locator('[data-testid^="person-link-"]').first());
    await expect(page.getByTestId("admin-person-view")).toBeVisible();
    const personSaved = page.waitForEvent("download");
    await activate(page.getByTestId("export-person-data"));

    // then
    expect((await personSaved).suggestedFilename()).toMatch(/^courtside-subject-access-[0-9a-f-]{36}\.json$/);
  });
