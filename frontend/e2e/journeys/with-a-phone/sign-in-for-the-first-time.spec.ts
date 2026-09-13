import { expect, test } from "../../fixtures";
import { credentialIn, messageTo } from "../../mailbox";
import { activate, openTheApplication, reachAdministration, signIn, signOut, walks, writeInto } from "../../journey-walking";

test("given a new member whose account the board has just opened, when they read the one-time password the club mailed them and choose one of their own, then they are in and nobody ever saw the password they were given",
  walks("session-and-own-account", "roster-membership-and-account-administration"),
  async ({ page, language, journeyService }) => {
    // given — the board opens the account, and never chooses the password
    await openTheApplication(page, language);
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await reachAdministration(page, "admin-roster-link");
    await expect(page.getByTestId("admin-roster-view")).toBeVisible();
    await writeInto(page.getByTestId("new-person-first-name"), "Richard");
    await writeInto(page.getByTestId("new-person-last-name"), "Roe");
    await writeInto(page.getByTestId("new-person-email"), "richard.roe@example.org");
    await activate(page.getByTestId("create-person"));
    await expect(page.getByTestId("admin-person-view")).toBeVisible();
    await writeInto(page.getByTestId("new-account-username"), "roe.richard");
    await activate(page.getByTestId("new-account-role-MEMBER"));
    await activate(page.getByTestId("create-account"));
    await expect(page.getByTestId("account-username")).toHaveValue("roe.richard");
    await signOut(page);

    // when — the member reads what reached their mailbox and signs in with it
    const mailed = await messageTo(journeyService.mailboxURL, "richard.roe@example.org");
    await signIn(page, "roe.richard", credentialIn(mailed, "Passwort:"));

    // then — the club refuses to go further until they have one of their own
    await expect(page.getByTestId("initial-password-view")).toBeVisible();

    // when
    await writeInto(page.getByTestId("new-password"), "the-one-they-picked-alone");
    await writeInto(page.getByTestId("confirm-password"), "the-one-they-picked-alone");
    await activate(page.getByTestId("password-submit"));

    // then
    await signIn(page, "roe.richard", "the-one-they-picked-alone");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await signOut(page);
  });
