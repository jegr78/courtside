import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

const MEMBER_LIST = [
  "Number;Given;Family;Mail;Status",
  "9001;Jane;Doe;jane.doe@example.org;active",
  "9002;John;Roe;john.roe@example.org;active",
  "9003;Mary;Major;mary.major@example.org;supporting",
  "9004;Richard;Miles;;active",
  "9005;Peter;Poe;peter.poe@example.org;active",
  "9006;Sam;Sample;peter.poe@example.org;active"
].join("\n");

async function signInAsAdministrator(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await page.getByTestId("administration-link").click();
  await expect(page.getByTestId("admin-shell")).toBeVisible();
}

async function chooseFile(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).setInputFiles({
    name: "members.csv", mimeType: "text/csv", buffer: Buffer.from(MEMBER_LIST, "utf8")
  });
}

test("a board describes its membership system, reads what a member list would do, and runs it",
  async ({ page }) => {
    // given a membership type the imported members will hold
    await signInAsAdministrator(page);
    await page.getByTestId("admin-membership-types-link").click();
    await expect(page.getByTestId("create-membership-type")).toBeVisible();
    await page.getByTestId("new-membership-type-name").fill("Imported adults");
    await page.getByTestId("new-membership-type-grants-account").check();
    const typeCreated = page.waitForResponse((response) =>
      response.url().endsWith("/api/admin/membership-types") && response.request().method() === "POST");
    await page.getByTestId("create-membership-type").click();
    const { id: membershipTypeId } = await (await typeCreated).json() as { id: string };

    // when the board describes the source, reading its own export in the browser
    await page.getByTestId("admin-import-link").click();
    await expect(page.getByTestId("no-sources")).toBeVisible();
    await page.getByTestId("new-source").click();
    await chooseFile(page, "source-file");

    // then the columns of that file are what it is offered, read with the separator the form
    // suggested from the file itself and the board is free to correct
    await expect(page.getByTestId("source-separator")).toHaveValue(";");
    await expect(page.getByTestId("column-EXTERNAL_ID")).toContainText("Number");

    // when
    await page.getByTestId("source-key").fill("club-registry");
    await page.getByTestId("source-name").fill("Club registry");
    await page.getByTestId("column-EXTERNAL_ID").selectOption("Number");
    await page.getByTestId("column-FIRST_NAME").selectOption("Given");
    await page.getByTestId("column-LAST_NAME").selectOption("Family");
    await page.getByTestId("column-EMAIL").selectOption("Mail");
    await page.getByTestId("source-default-type").selectOption(membershipTypeId);
    const sourceCreated = page.waitForResponse((response) =>
      response.url().endsWith("/api/admin/import/sources") && response.request().method() === "POST");
    await page.getByTestId("save-source").click();
    expect((await sourceCreated).status()).toBe(201);

    // then the source is described and the file has never left the browser
    await expect(page.getByTestId("no-references")).toBeVisible();

    // when the same file is uploaded as a partial list
    await chooseFile(page, "snapshot-file");
    const previewed = page.waitForResponse((response) =>
      response.url().includes("/previews") && response.request().method() === "POST");
    await page.getByTestId("upload-snapshot").click();
    expect((await previewed).status()).toBe(201);

    // then the preview counts the six rows and names the file it read
    await expect(page.getByTestId("preview-identity")).toContainText("members.csv");
    await expect(page.getByTestId("changes-heading")).toContainText("6");
    await expect(page.getByTestId("row-errors-heading")).toContainText("0");

    // and it says how many sign-ins it would open: two, because this world already holds people
    // by three of the names and one row carries no address to send a credential to
    await expect(page.getByTestId("preview-accounts")).toContainText("2");

    // and it names the two rows whose one-time passwords would land in the same mailbox, which is
    // the count section 10 promises a board sees before anything is sent
    await page.getByTestId("shared-addresses-heading").click();
    await expect(page.getByTestId("shared-addresses-heading")).toContainText("2");
    await expect(page.getByTestId("shared-address-9005")).toContainText("2");
    await expect(page.getByTestId("shared-address-9006")).toContainText("2");

    // when the run is executed, which is confirmed because repeating it does not undo it
    await page.getByTestId("execute-preview").click();
    const executed = page.waitForResponse((response) =>
      response.url().includes("/execution") && response.request().method() === "POST");
    await page.getByTestId("confirm-execute").click();
    expect((await executed).status()).toBe(200);

    // then the result names what it did and the run joins the log
    await expect(page.getByTestId("run-result-created")).toContainText("6");
    await expect(page.getByTestId("run-result-accountsCreated")).toContainText("2");
    await expect(page.getByTestId("run-result-rowErrors")).toContainText("0");
    await expect(page.locator('[data-testid^="import-run-"]').first()).toBeVisible();

    // and every member number the file carried now answers for somebody, including the row for
    // the person the club has no address for - they get a record and no sign-in
    await expect(page.getByTestId("reference-9001")).toBeVisible();
    await expect(page.getByTestId("reference-9004")).toBeVisible();
  });

test("a member number the file does not yet carry is linked by hand rather than duplicated",
  async ({ page }) => {
    // given a person the club entered before it read this source in
    await signInAsAdministrator(page);
    await page.getByTestId("admin-roster-link").click();
    await page.getByTestId("new-person-first-name").fill("Mary");
    await page.getByTestId("new-person-last-name").fill("Major");
    await page.getByTestId("new-person-email").fill("mary.major@example.org");
    const personCreated = page.waitForResponse((response) =>
      response.url().endsWith("/api/admin/roster") && response.request().method() === "POST");
    await page.getByTestId("create-person").click();
    const { personId } = await (await personCreated).json() as { personId: string };

    // and a source to link them from
    await page.goto("/admin/import");
    await expect(page.getByTestId("no-sources")).toBeVisible();
    await page.getByTestId("new-source").click();
    await chooseFile(page, "source-file");
    await page.getByTestId("source-key").fill("club-registry");
    await page.getByTestId("source-name").fill("Club registry");
    await page.getByTestId("column-EXTERNAL_ID").selectOption("Number");
    await page.getByTestId("column-FIRST_NAME").selectOption("Given");
    await page.getByTestId("column-LAST_NAME").selectOption("Family");
    await expect(page.getByTestId("source-separator")).toHaveValue(";");
    await page.getByTestId("source-default-type").selectOption({ index: 1 });
    await page.getByTestId("save-source").click();
    await expect(page.getByTestId("no-references")).toBeVisible();

    // when the board links that person to the number the source holds for them
    await page.getByTestId("reference-person-search").fill("Major");
    await page.getByTestId(`reference-person-${personId}`).click();
    await page.getByTestId("reference-external-id").fill("9003");
    const linked = page.waitForResponse((response) =>
      response.url().endsWith("/references") && response.request().method() === "POST");
    await page.getByTestId("link-reference").click();
    expect((await linked).status()).toBe(201);

    // then the link names the person rather than their id
    await expect(page.getByTestId("reference-9003")).toContainText("Mary Major");

    // when the file is previewed, the row that names her is no longer a creation
    await chooseFile(page, "snapshot-file");
    await page.getByTestId("upload-snapshot").click();
    await page.getByTestId("changes-heading").click();

    // then her row is not a creation, and she is missing from the duplicate report - the journey
    // world already holds people by three of the other names, which is what makes that report
    // worth having in the first place, and the two it does not hold are absent for that reason
    await expect(page.getByTestId("change-CREATE-9001")).toBeVisible();
    await expect(page.getByTestId("change-CREATE-9003")).toHaveCount(0);
    await page.getByTestId("duplicates-heading").click();
    await expect(page.getByTestId("duplicate-9001")).toBeVisible();
    await expect(page.getByTestId("duplicate-9003")).toHaveCount(0);
  });
