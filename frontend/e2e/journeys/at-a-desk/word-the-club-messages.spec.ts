import { expect, test } from "../../fixtures";
import { activate, openTheApplication, reachAdministration, rewrite, signIn, walks } from "../../journey-walking";

test("given a board that wants its reminders to sound like the club, when it words one, previews it and later restores the shipped text, then the club's wording applies until it is restored",
  walks("session-and-own-account", "message-wording"),
  async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await expect(page.getByTestId("admin-shell")).toBeVisible();
    await reachAdministration(page, "admin-message-wording-link");
    await expect(page.getByTestId("admin-message-wording-view")).toBeVisible();
    await page.getByTestId("wording-kind").selectOption("ACCOUNT_USERNAME_REMINDER");
    await expect(page.getByTestId("wording-state")).toHaveAttribute("data-own", "false");

    // when — the board words the reminder and looks at it before anyone receives it
    await rewrite(page.getByTestId("wording-subject"), "Your username at {clubName}");
    await rewrite(page.getByTestId("wording-body"), "Hello {firstName}, you sign in as {username}.\n{instanceLink}");
    await activate(page.getByTestId("wording-preview"));

    // then
    await expect(page.getByTestId("wording-preview-body")).toContainText("you sign in as");
    await expect(page.getByTestId("wording-preview-body")).not.toContainText("{username}");

    // when
    await activate(page.getByTestId("wording-save"));

    // then
    await expect(page.getByTestId("wording-success")).toBeVisible();
    await expect(page.getByTestId("wording-state")).toHaveAttribute("data-own", "true");

    // when — and restores the shipped text
    await activate(page.getByTestId("wording-reset"));

    // then
    await expect(page.getByTestId("wording-state")).toHaveAttribute("data-own", "false");
    await expect(page.getByTestId("wording-subject")).not.toHaveValue("Your username at {clubName}");
  });
