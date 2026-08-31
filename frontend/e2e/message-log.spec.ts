import { expect, test } from "./fixtures";
import { credentialIn, messageTo } from "./mailbox";

async function signInAsAdministrator(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("administration-link").click();
  await expect(page.getByTestId("admin-messages-link")).toBeVisible();
}

async function openTheMessageLog(page: import("@playwright/test").Page) {
  await page.getByTestId("admin-messages-link").click();
  await expect(page.getByTestId("admin-messages-view")).toBeVisible();
}

// A record is written and then settled after the request that caused it has answered, so a page
// showing one is read again until it says what became of the message.
async function statesInTheLog(page: import("@playwright/test").Page, expected: string[]) {
  await expect.poll(async () => page.locator('[data-testid="message-row"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-state")))
    .then(async (states) => {
      if (states.length !== expected.length || states.some((state) => state === "QUEUED")) {
        await page.reload();
        await expect(page.getByTestId("admin-messages-view")).toBeVisible();
        return undefined;
      }
      return states;
    }), { timeout: 20_000 }).toEqual(expected);
}

async function lastMessageOnThePerson(page: import("@playwright/test").Page, expected: string) {
  await expect.poll(async () => {
    const state = await page.getByTestId("last-message").getAttribute("data-state").catch(() => null);
    if (state === expected) return state;
    await page.reload();
    await expect(page.getByTestId("admin-person-view")).toBeVisible();
    return state;
  }, { timeout: 20_000 }).toBe(expected);
}

test("a board mistypes an address, the log shows the refusal, and the correction is sent", async ({ page, journeyService }) => {
  // given
  await signInAsAdministrator(page);
  await page.getByTestId("admin-roster-link").click();
  await expect(page.getByTestId("admin-roster-view")).toBeVisible();
  await page.getByTestId("new-person-first-name").fill("Richard");
  await page.getByTestId("new-person-last-name").fill("Miles");
  await page.getByTestId("new-person-email").fill("richard.miles@exmaple.org");
  const personCreated = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/roster") && response.request().method() === "POST");
  await page.getByTestId("create-person").click();
  const { personId } = await (await personCreated).json() as { personId: string };

  // when — the account is created, and the relay refuses the address nobody holds
  await expect(page).toHaveURL(new RegExp(`/admin/roster/${personId}$`));
  await page.getByTestId("new-account-username").fill("miles.richard");
  await page.getByTestId("new-account-role-MEMBER").check();
  const accountCreated = page.waitForResponse((response) =>
    response.url().endsWith(`/api/admin/roster/${personId}/account`) && response.request().method() === "POST");
  await page.getByTestId("create-account").click();
  expect((await accountCreated).status()).toBe(201);

  // then — the log says what became of it, and says what handed over would have meant
  await openTheMessageLog(page);
  await statesInTheLog(page, ["REFUSED"]);
  const refusedRow = page.getByTestId("message-row").first();
  await expect(refusedRow.getByTestId("message-outcome")).not.toBeEmpty();
  await expect(page.getByTestId("messages-handover-note")).toBeVisible();
  await expect(page.getByTestId("messages-refused-hint")).toBeVisible();
  await expect(page.locator('[data-testid="admin-messages-view"] table button')).toHaveCount(0);

  // when — the row points at the person to correct, which is the only remedy there is
  await refusedRow.getByTestId("message-person-link").click();
  await expect(page.getByTestId("admin-person-view")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/admin/roster/${personId}$`));
  await lastMessageOnThePerson(page, "REFUSED");
  await page.getByTestId("person-email").fill("richard.miles@example.org");
  await page.getByTestId("save-person").click();
  await page.getByTestId("send-credentials").click();

  // then — the correction goes out, and the member holds what the log never shows
  const mailed = await messageTo(journeyService.mailboxURL, "richard.miles@example.org");
  const credential = credentialIn(mailed, "Passwort:");
  await lastMessageOnThePerson(page, "HANDED_OVER");
  await openTheMessageLog(page);
  await statesInTheLog(page, ["HANDED_OVER", "REFUSED"]);
  await expect(page.getByTestId("admin-messages-view")).not.toContainText(credential);

  // when — only what went wrong is asked for
  await page.getByTestId("messages-unsettled-filter").check();

  // then
  await expect(page.getByTestId("message-row")).toHaveCount(1);
  await expect(page.getByTestId("message-row").first()).toHaveAttribute("data-state", "REFUSED");
});
