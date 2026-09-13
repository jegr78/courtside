import { expect, test } from "../../fixtures";
import { activate, journeyFile, openTheApplication, reachAdministration, signIn, walks, writeInto } from "../../journey-walking";

test("given a board that keeps its members in another system, when they describe that export once, read what it would do and run it, then the club holds the same people and a second, changed export updates them",
  walks("session-and-own-account", "facility-card-and-membership-configuration", "roster-import-and-full-sync"),
  async ({ page, language }) => {
    // given — a membership the imported people will hold
    await openTheApplication(page, language);
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await expect(page.getByTestId("admin-shell")).toBeVisible();
    await reachAdministration(page, "admin-membership-types-link");
    await writeInto(page.getByTestId("new-membership-type-name"), "Imported adults");
    await activate(page.getByTestId("new-membership-type-grants-account"));
    await activate(page.getByTestId("create-membership-type"));
    await expect(page.getByTestId("admin-save-success")).toBeVisible();

    // when — the board describes the export it already has
    await reachAdministration(page, "admin-import-link");
    await expect(page.getByTestId("no-sources")).toBeVisible();
    await activate(page.getByTestId("new-source"));
    await page.getByTestId("source-file").setInputFiles(journeyFile("members.csv"));

    // then — the columns offered are the ones the file carries
    await expect(page.getByTestId("source-separator")).toHaveValue(";");
    await expect(page.getByTestId("column-EXTERNAL_ID")).toContainText("Number");

    // when
    await writeInto(page.getByTestId("source-key"), "club-registry");
    await writeInto(page.getByTestId("source-name"), "Club registry");
    for (const [column, heading] of [["EXTERNAL_ID", "Number"], ["FIRST_NAME", "Given"],
      ["LAST_NAME", "Family"], ["EMAIL", "Mail"]]) {
      await page.getByTestId(`column-${column}`).selectOption(heading);
    }
    await page.getByTestId("source-default-type").selectOption({ index: 1 });
    await activate(page.getByTestId("save-source"));

    // then
    await expect(page.getByTestId("no-references")).toBeVisible();

    // when — the list is read, and what it would do is shown before anything happens
    await page.getByTestId("snapshot-file").setInputFiles(journeyFile("members.csv"));
    await activate(page.getByTestId("upload-snapshot"));
    await expect(page.getByTestId("preview-identity")).toContainText("members.csv");
    await activate(page.getByTestId("execute-preview"));
    await activate(page.getByTestId("confirm-execute"));

    // then — every member number the file carried now answers for somebody
    await expect(page.getByTestId("reference-9001")).toBeVisible();
    await expect(page.getByTestId("reference-9004")).toBeVisible();

    // when — the club sends the list again with a row changed and one added
    await page.getByTestId("snapshot-file").setInputFiles(journeyFile("members-changed.csv"));
    await activate(page.getByTestId("upload-snapshot"));
    await activate(page.getByTestId("execute-preview"));
    await activate(page.getByTestId("confirm-execute"));

    // then
    await expect(page.getByTestId("reference-9007")).toBeVisible();
  });
