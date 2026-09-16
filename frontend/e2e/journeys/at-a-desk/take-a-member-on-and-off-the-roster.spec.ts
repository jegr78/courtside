import { expect, test } from "../../fixtures";
import { messageTo } from "../../mailbox";
import { activate, openTheApplication, reachAdministration, rewrite, signIn, walks, writeDate, writeInto } from "../../journey-walking";

test("given a board that has taken on a new member, when they record the person, correct the name they mistyped, give them an account and later end the membership, then every step is one the board can take without a database console",
  walks("session-and-own-account", "roster-membership-and-account-administration"),
  async ({ page, language, journeyService }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await expect(page.getByTestId("admin-setup-view")).toBeVisible();

    // when — the person is recorded, with a first name that goes in wrong
    await reachAdministration(page, "admin-roster-link");
    await expect(page.getByTestId("admin-roster-view")).toBeVisible();
    await writeInto(page.getByTestId("new-person-first-name"), "Mray");
    await writeInto(page.getByTestId("new-person-last-name"), "Major");
    await writeInto(page.getByTestId("new-person-email"), "mary.major@example.org");
    await activate(page.getByTestId("create-person"));

    // then
    await expect(page.getByTestId("admin-person-view")).toBeVisible();

    // when — and the club corrects it in the product
    await rewrite(page.getByTestId("person-first-name"), "Mary");
    await activate(page.getByTestId("save-person"));

    // then — the field holds what was typed before the club has stored it, so the answer is what
    // the journey waits for
    await expect(page.getByTestId("admin-save-success")).toBeVisible();

    // when — the member is given a way in
    await writeInto(page.getByTestId("new-account-username"), "major.mary");
    await activate(page.getByTestId("new-account-role-MEMBER"));
    await activate(page.getByTestId("create-account"));

    // then — the one-time password went to the member, and the board never saw it
    await expect(page.getByTestId("account-username")).toHaveValue("major.mary");
    await expect(page.getByTestId("credential-destination")).toContainText("mary.major@example.org");

    // when — the club records what the person joined as, without waiting for that message: the
    // instance answers first and writes the account again when it hands the credential over.
    await page.getByTestId("membership-type").selectOption({ index: 1 });
    await writeDate(page.getByTestId("membership-started-on"), "2026-01-01");
    await activate(page.getByTestId("save-membership"));

    // then
    await expect(page.getByTestId("end-membership")).toBeVisible();
    await messageTo(journeyService.mailboxURL, "mary.major@example.org");

    // when — and the membership ends, with the sessions that account holds. A club records a
    // departure that has happened, so a day the club has not reached yet is refused.
    await activate(page.getByTestId("end-membership"));
    await writeDate(page.getByTestId("end-membership-date"), "2026-04-30");
    await activate(page.getByTestId("confirm-end-membership"));

    // then
    await expect(page.getByTestId("membership-ended-on")).toHaveValue("2026-04-30");

    // when
    await activate(page.getByTestId("end-account-sessions"));

    // then
    await expect(page.getByTestId("admin-save-success")).toBeVisible();
  });
