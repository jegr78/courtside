import { expect, test } from "../../fixtures";
import { activate, openTheApplication, reachAdministration, rewrite, signIn, walks, writeDate, writeInto } from "../../journey-walking";

const STILL_BOOKED = "00000000-0000-0000-0000-000000000103";
const STILL_A_MEMBER = "00000000-0000-0000-0000-000000000112";

async function endTheMembershipOf(page: import("@playwright/test").Page, endedOn: string): Promise<void> {
  await activate(page.getByTestId("end-membership"));
  await writeDate(page.getByTestId("end-membership-date"), endedOn);
  await activate(page.getByTestId("confirm-end-membership"));
  await expect(page.getByTestId("membership-ended-on")).toHaveValue(endedOn);
}

async function findOnTheRoster(page: import("@playwright/test").Page, name: string): Promise<void> {
  await reachAdministration(page, "admin-roster-link");
  await expect(page.getByTestId("admin-roster-view")).toBeVisible();
  await rewrite(page.getByTestId("roster-search"), name);
  await activate(page.getByTestId("roster-search-submit"));
}

test("given a board that keeps former members a month and bookings two years, when it previews and confirms a retention run, then only the member who left long ago and is named nowhere is removed",
  walks("session-and-own-account", "personal-data-retention"),
  async ({ page, language }) => {
    // given — a member who left in spring and was never given an account
    await openTheApplication(page, language);
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await expect(page.getByTestId("admin-overview-view")).toBeVisible();
    await reachAdministration(page, "admin-roster-link");
    await writeInto(page.getByTestId("new-person-first-name"), "John");
    await writeInto(page.getByTestId("new-person-last-name"), "Roe");
    await writeInto(page.getByTestId("new-person-email"), "john.roe@example.org");
    await activate(page.getByTestId("create-person"));
    await expect(page.getByTestId("admin-person-view")).toBeVisible();
    await page.getByTestId("membership-type").selectOption({ index: 1 });
    await writeDate(page.getByTestId("membership-started-on"), "2026-01-01");
    await activate(page.getByTestId("save-person"));
    await expect(page.getByTestId("end-membership")).toBeVisible();
    const departed = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    await endTheMembershipOf(page, "2026-03-31");

    // given — and one who left at the same time but still plays in tomorrow's booking
    await findOnTheRoster(page, "Mary Major");
    await activate(page.getByTestId(`person-link-${STILL_BOOKED}`));
    await expect(page.getByTestId("admin-person-view")).toBeVisible();
    await endTheMembershipOf(page, "2026-03-31");

    // when — the board sets the periods it chose
    await reachAdministration(page, "admin-retention-link");
    await expect(page.getByTestId("admin-retention-view")).toBeVisible();
    await expect(page.getByTestId("retention-preview")).toBeDisabled();
    await writeInto(page.getByTestId("retention-months-FORMER_MEMBERS"), "1");
    await activate(page.getByTestId("retention-save-FORMER_MEMBERS"));
    await expect(page.getByTestId("retention-state-FORMER_MEMBERS")).toHaveAttribute("data-configured", "true");
    await writeInto(page.getByTestId("retention-months-BOOKINGS"), "24");
    await activate(page.getByTestId("retention-save-BOOKINGS"));
    await expect(page.getByTestId("retention-state-BOOKINGS")).toHaveAttribute("data-configured", "true");

    // then — the preview counts before anything changes, and names who it cannot reach and why
    await activate(page.getByTestId("retention-preview"));
    await expect(page.getByTestId("retention-preview-former-members")).toBeVisible();
    await expect(page.getByTestId("retention-preview-bookings")).toBeVisible();
    const blocked = page.getByTestId("retention-blocked-row");
    await expect(blocked).toHaveCount(1);
    await expect(blocked).toHaveAttribute("data-reason", "NAMED_IN_BOOKINGS");
    await expect(page.getByTestId("retention-run")).toBeDisabled();

    // when — the board confirms in the form that the run is final
    await activate(page.getByTestId("retention-acknowledge"));
    await activate(page.getByTestId("retention-run"));

    // then
    await expect(page.getByTestId("retention-run-result")).toBeVisible();
    await expect(page.getByTestId("retention-run-formerMembersRemoved")).toHaveText(/^\D*1\D*$/);
    await expect(page.getByTestId("retention-preview-result")).toHaveCount(0);

    // then — the member named in a booking is still on the roster, the other is not
    await findOnTheRoster(page, "Mary Major");
    await expect(page.getByTestId(`person-link-${STILL_BOOKED}`)).toBeVisible();
    await findOnTheRoster(page, "John Roe");
    await expect(page.getByTestId(`person-link-${STILL_A_MEMBER}`)).toBeVisible();
    await expect(page.getByTestId(`person-link-${departed}`)).toHaveCount(0);

    // when — and a period the board takes back is gone again
    await reachAdministration(page, "admin-retention-link");
    await activate(page.getByTestId("retention-remove-BOOKINGS"));

    // then
    await expect(page.getByTestId("retention-state-BOOKINGS")).toHaveAttribute("data-configured", "false");
  });
