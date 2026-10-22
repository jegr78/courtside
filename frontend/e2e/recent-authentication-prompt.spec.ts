import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

async function personOf(page: Page, search: () => Promise<void>, username: string): Promise<string> {
  const answered = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/roster-search") && response.request().method() === "POST");
  await search();
  const { entries } = await (await answered).json() as { entries: Array<{ personId: string; username: string | null }> };
  const entry = entries.find((candidate) => candidate.username === username);
  expect(entry, `the search finds ${username}`).toBeDefined();
  return entry!.personId;
}

const RECENT_AUTH = {
  type: "urn:courtside:error:recent-authentication-required",
  title: "Recent authentication required",
  status: 403,
  detail: "Confirm the password before this change",
  violations: [{ code: "identity.reauthentication.required", params: {} }]
};

test("a board asked to confirm its password while a dialog form is open confirms it on top of that form and the save goes through",
  async ({ page, journeyService }) => {
    // given the board fills the guardian form on a member's page
    await page.goto("/login");
    await page.getByTestId("username").fill("configuration-admin");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await page.getByTestId("administration-link").click();
    await page.getByTestId("admin-roster-link").click();
    await expect(page.getByTestId("admin-roster-view")).toBeVisible();
    const dependant = await personOf(page, async () => {
      await page.getByTestId("roster-search").fill("Doe");
      await page.getByTestId("roster-search-submit").click();
    }, "doe.jane");
    await page.goto(`/admin/roster/${dependant}`);
    await page.getByTestId("add-guardianship").click();
    const form = page.getByRole("dialog");
    await form.getByTestId("guardianship-as-dependant").check();
    const guardian = await personOf(page, () => form.getByTestId("guardianship-search").fill("Roe"), "roe.jane");
    await form.locator(`[data-testid="guardianship-match"][data-person-id="${guardian}"]`).click();
    await form.getByTestId("guardianship-grant-VIEW_BOOKINGS").check();
    let asked = false;
    await page.route("**/api/admin/roster/*/guardianships", async (route) => {
      if (route.request().method() !== "POST" || asked) return route.fallback();
      asked = true;
      await route.fulfill({ status: 403, contentType: "application/problem+json", body: JSON.stringify(RECENT_AUTH) });
    });

    // when the save asks for a recent sign-in
    await page.getByTestId("save-guardianship").click();
    const confirm = page.getByTestId("admin-reauthentication-submit");
    await expect(confirm).toBeVisible();

    // then the prompt takes the pointer above the form, and the form kept what was entered
    await expect(confirm.click({ trial: true, timeout: 2_000 }), "the prompt's confirm button receives the click").resolves.toBeUndefined();
    await expect(page.getByTestId("guardianship-chosen"), "the form keeps the chosen person").toBeAttached();
    await page.locator("#admin-reauthentication-password").fill("temporary-password");
    const repeated = page.waitForResponse((response) =>
      response.url().endsWith("/guardianships") && response.request().method() === "POST");
    await confirm.click();
    const answer = await repeated;
    expect(answer.status(), "the repeated save links the guardian").toBe(201);
    const { id } = await answer.json() as { id: string };
    await expect(page.getByTestId(`guardianship-${id}`)).toBeVisible();
    await journeyService.executeSql(`DELETE FROM guardian_relationship WHERE id = '${id}'`);
  });
