import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

async function signInAsAdministrator(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await page.getByTestId("administration-link").click();
  await expect(page.getByTestId("admin-shell")).toBeVisible();
}

async function addPerson(page: Page, firstName: string, lastName: string): Promise<string> {
  await page.getByTestId("admin-roster-link").click();
  await expect(page.getByTestId("admin-roster-view")).toBeVisible();
  await page.getByTestId("new-person-first-name").fill(firstName);
  await page.getByTestId("new-person-last-name").fill(lastName);
  await page.getByTestId("new-person-email").fill(`${firstName}.${lastName}@example.org`.toLowerCase());
  const created = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/roster") && response.request().method() === "POST");
  await page.getByTestId("create-person").click();
  const { personId } = await (await created).json() as { personId: string };
  await expect(page).toHaveURL(new RegExp(`/admin/roster/${personId}$`));
  return personId;
}

async function enterPeriod(page: Page, startedOn: string, endedOn?: string): Promise<void> {
  await page.getByTestId("add-period").click();
  const form = page.getByRole("dialog");
  await form.getByTestId("period-type").selectOption({ index: 1 });
  await form.getByTestId("period-started-on").fill(startedOn);
  if (endedOn) await form.getByTestId("period-ended-on").fill(endedOn);
}

function periodWrite(page: Page, personId: string) {
  return page.waitForResponse((response) =>
    response.url().endsWith(`/api/admin/roster/${personId}/membership-periods`)
    && response.request().method() === "POST");
}

test("a board records a past and a scheduled period, is refused an overlapping one, and the scheduled one grants nothing yet",
  async ({ page }) => {
    // given a person with a membership that has ended
    await signInAsAdministrator(page);
    const personId = await addPerson(page, "Mary", "Major");
    await enterPeriod(page, "2020-01-01", "2021-01-01");
    const past = periodWrite(page, personId);
    await page.getByRole("dialog").getByTestId("save-period").click();
    expect((await past).status()).toBe(201);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // when the board enters a period that overlaps it
    await enterPeriod(page, "2020-06-01");
    const overlapping = periodWrite(page, personId);
    await page.getByRole("dialog").getByTestId("save-period").click();
    const refusal = await overlapping;

    // then it is refused by its own type and the form says why
    expect(refusal.status()).toBe(409);
    expect((await refusal.json() as { type: string }).type).toBe("urn:courtside:error:membership-periods-overlap");
    const form = page.getByRole("dialog");
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(form.getByRole("alert")).not.toHaveText("");
    await form.getByTestId("cancel-period").click();

    // when the board schedules a period that begins later
    await enterPeriod(page, "2999-01-01");
    const scheduled = periodWrite(page, personId);
    await page.getByRole("dialog").getByTestId("save-period").click();
    const { id } = await (await scheduled).json() as { id: string };

    // then it is listed as scheduled and the person is not a member today
    await expect(page.getByTestId(`membership-period-state-${id}`)).toHaveAttribute("data-state", "scheduled");
    await expect(page.getByTestId("membership-periods-list").getByRole("listitem")).toHaveCount(2);
    const entry = await page.evaluate(async (id) =>
      (await fetch(`/api/admin/roster/${id}`)).json() as Promise<{ membershipCurrent: boolean }>, personId);
    expect(entry.membershipCurrent, "a period that begins later makes nobody a member today").toBe(false);
    await expect(page.getByTestId("end-membership")).toHaveCount(0);
  });
