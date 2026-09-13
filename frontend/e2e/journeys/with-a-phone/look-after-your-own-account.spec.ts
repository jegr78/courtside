import { expect, test } from "../../fixtures";
import { activate, openTheAccountMenu, openTheApplication, signIn, walks, writeInto } from "../../journey-walking";

test("given a member who wants their account in order, when they choose a new password, review the browsers they are signed in on and pick what the club writes to them, then each choice is the one the next visit reads",
  walks("session-and-own-account"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "doe.jane");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();

    // when — the club is told which messages are wanted
    await activate(page.getByTestId("my-messages-link"));
    await expect(page.getByTestId("my-messages-view")).toBeVisible();
    await activate(page.getByTestId("message-choice-BOOKING_REMINDER"));
    await activate(page.getByTestId("my-messages-save"));

    // then — and it is the stored choice that the page shows again, not the one still on screen
    await expect(page.getByTestId("my-messages-saved")).toBeVisible();
    await activate(page.getByTestId("court-plan-link"));
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await activate(page.getByTestId("my-messages-link"));
    await expect(page.getByTestId("message-choice-BOOKING_REMINDER")).not.toBeChecked();

    // when — the browsers this account is signed in on are read
    await openTheAccountMenu(page);
    await activate(page.getByTestId("account-security-link"));
    await expect(page.getByTestId("account-security-view")).toBeVisible();
    await expect(page.getByTestId("end-current-session")).toHaveCount(1);

    // when — and a password of the member's own replaces the one they were given
    await writeInto(page.getByTestId("new-password"), "a-password-nobody-guesses");
    await writeInto(page.getByTestId("confirm-password"), "a-password-nobody-guesses");
    await activate(page.getByTestId("password-submit"));

    // then — changing it ends every session, so the way back in is the new password
    await expect(page.getByTestId("login-view").or(page.getByTestId("sign-in-link"))).toBeVisible();
    await signIn(page, "doe.jane", "a-password-nobody-guesses");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
  });
