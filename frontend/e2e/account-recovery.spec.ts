import { expect, test } from "./fixtures";
import { credentialIn, messageTo } from "./mailbox";

test("a member who forgot their password gets back in without asking the board",
  async ({ page, journeyService }) => {
    // given
    await page.goto("/login");
    await page.getByTestId("forgotten-credentials-link").click();
    await expect(page.getByTestId("account-recovery-view")).toBeVisible();

    // when
    const asked = page.waitForResponse((response) =>
      response.url().endsWith("/api/account-recovery/password")
        && response.request().method() === "POST");
    await page.getByTestId("recovery-username").fill("doe.jane");
    await page.getByTestId("recovery-password-submit").click();

    // then — the answer says a message may follow, never that one did
    expect((await asked).status()).toBe(202);
    await expect(page.getByTestId("recovery-sent")).toBeVisible();

    // then — the password the member still holds keeps working, because asking changed nothing
    const mailed = await messageTo(journeyService.mailboxURL, "jane.doe@example.org");
    const code = credentialIn(mailed, "Code:");
    await page.getByTestId("recovery-back-to-login").click();
    await page.getByTestId("username").fill("doe.jane");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("court-plan-view")).toBeVisible();

    // when — the member redeems the code with a password of their own
    await page.getByTestId("preferences-menu").click();
    await page.getByTestId("logout").click();
    await expect(page.getByTestId("login-view")).toBeVisible();
    await page.getByTestId("forgotten-credentials-link").click();
    await page.getByTestId("recovery-code").fill(code);
    await page.getByTestId("recovery-new-password").fill("the-one-they-picked-alone");
    await page.getByTestId("recovery-redeem-submit").click();
    await expect(page.getByTestId("recovery-sent")).toBeVisible();

    // then — that password signs them in, and it is not one they are made to replace
    await page.goto("/login");
    await page.getByTestId("username").fill("doe.jane");
    await page.getByTestId("password").fill("the-one-they-picked-alone");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
  });

test("a code the instance never sent is refused, and says so", async ({ page }) => {
  // given
  await page.goto("/account-recovery");

  // when
  await page.getByTestId("recovery-code").fill("ABCD-EFGH");
  await page.getByTestId("recovery-new-password").fill("the-one-they-picked-alone");
  await page.getByTestId("recovery-redeem-submit").click();

  // then — the refusal names the code, so the contract pattern accepting it is part of the proof
  await expect(page.getByRole("alert"))
    .toHaveText("That code does not match. Check what you entered, or ask for a new one above.");
  await expect(page.getByTestId("recovery-sent")).toBeHidden();
});

test("a name nobody holds is answered exactly like one that exists", async ({ page }) => {
  // given
  await page.goto("/account-recovery");

  // when
  const asked = page.waitForResponse((response) =>
    response.url().endsWith("/api/account-recovery/password")
      && response.request().method() === "POST");
  await page.getByTestId("recovery-username").fill("nobody.here");
  await page.getByTestId("recovery-password-submit").click();

  // then
  const answer = await asked;
  expect(answer.status()).toBe(202);
  await expect(page.getByTestId("recovery-sent")).toBeVisible();
});

test("a member who forgot their name is reminded of it, and their password still works",
  async ({ page, journeyService }) => {
    // given
    await page.goto("/account-recovery");

    // when
    const asked = page.waitForResponse((response) =>
      response.url().endsWith("/api/account-recovery/usernames")
        && response.request().method() === "POST");
    await page.getByTestId("recovery-email").fill("jane.doe@example.org");
    await page.getByTestId("recovery-usernames-submit").click();

    // then
    expect((await asked).status()).toBe(202);
    const mailed = await messageTo(journeyService.mailboxURL, "jane.doe@example.org");
    expect(mailed.Text).toContain("doe.jane");
    expect(mailed.Text).not.toContain("temporary-password");

    // then — nothing was issued, so the password the member already had still signs them in
    await page.getByTestId("recovery-back-to-login").click();
    await page.getByTestId("username").fill("doe.jane");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
  });
