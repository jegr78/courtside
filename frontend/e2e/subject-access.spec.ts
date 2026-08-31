import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  await page.getByTestId("new-person-email")
    .fill(`${firstName}.${lastName}@example.org`.toLowerCase());
  const created = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/roster") && response.request().method() === "POST");
  await page.getByTestId("create-person").click();
  const { personId } = await (await created).json() as { personId: string };
  return personId;
}

test("a board answers what the club holds about one member, and about nobody else",
  async ({ page }) => {
    // given two people the club holds data about
    await signInAsAdministrator(page);
    const otherPersonId = await addPerson(page, "Mary", "Major");
    const personId = await addPerson(page, "Richard", "Miles");
    await expect(page).toHaveURL(new RegExp(`/admin/roster/${personId}$`));
    await page.getByTestId("new-account-username").fill("miles.richard");
    await page.getByTestId("new-account-role-MEMBER").check();
    const accountCreated = page.waitForResponse((response) =>
      response.url().endsWith(`/api/admin/roster/${personId}/account`)
      && response.request().method() === "POST");
    await page.getByTestId("create-account").click();
    expect((await accountCreated).status()).toBe(201);

    // when the board produces the answer one of them is entitled to
    const saved = page.waitForEvent("download");
    await page.getByTestId("export-person-data").click();
    const download = await saved;
    // The browser runs in the pinned image, so the file has to be fetched over the connection.
    const saveTo = join(await mkdtemp(join(tmpdir(), "courtside-answer-")), "answer.json");
    await download.saveAs(saveTo);
    const answer = await readFile(saveTo, "utf8");

    // then the file answers about that member
    expect(download.suggestedFilename()).toBe(`courtside-subject-access-${personId}.json`);
    const held = JSON.parse(answer) as {
      personId: string; firstName: string; lastName: string; email: string | null;
      accounts: { username: string }[];
    };
    expect(held.personId).toBe(personId);
    expect(held.firstName).toBe("Richard");
    expect(held.lastName).toBe("Miles");
    expect(held.email).toBe("richard.miles@example.org");
    expect(held.accounts.map((account) => account.username)).toEqual(["miles.richard"]);

    // and about nobody else
    expect(answer).not.toContain(otherPersonId);
    expect(answer).not.toContain("Mary");
    expect(answer).not.toContain("Major");

    // and that it was produced is itself in the change log
    await page.getByTestId("person-audit-link").click();
    await expect(page.getByTestId("admin-audit-view")).toBeVisible();
    await expect(page.locator(
      '[data-testid="audit-row"][data-event-type="dataexchange.subjectAccess.answered"]'))
      .toHaveCount(1);
  });
