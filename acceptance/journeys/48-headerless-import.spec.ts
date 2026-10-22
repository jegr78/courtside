import { test, expect } from "@playwright/test";
import { capture } from "../lib/checks";
import { adminDelete, apiAs } from "../lib/api";
import { openAs, reauthenticateIfAsked } from "../lib/session";
import { step } from "../lib/steps";
import { projectName } from "../lib/journey";
import { recordCreated } from "../lib/ledger";
import { precondition } from "../lib/precondition";
import { IMPORT_SOURCE_PREFIX, answers } from "../lib/core.mjs";

// One profile: the source and its previews are the server's, and a second profile would only repeat them.
const PROFILE = "desktop-chrome";
const FIELDS = ["EXTERNAL_ID", "FIRST_NAME", "LAST_NAME"] as const;

test.beforeEach(() => { test.skip(projectName() !== PROFILE, `the headerless import journey runs on ${PROFILE}`); });
test.setTimeout(150_000);

type Problem = { type?: string; violations?: { code: string; params: Record<string, unknown> }[] };
type Preview = { rowCount: number; ignoredColumns: string[]; rowErrors: unknown[]; changes: { kind: string; externalId: string }[] };

const csv = (rows: string[][]) => Buffer.from(rows.map((row) => row.join(";")).join("\n") + "\n");
const file = (name: string, rows: string[][]) => ({ name, mimeType: "text/csv", buffer: csv(rows) });

test("given a headerless export, when the admin describes it by column position on a source of its own, then a preview reads every row as a member and an export that lost a column is refused before any row is read, and nothing reaches the roster", async ({ browser }) => {
  // given
  const admin = await apiAs("admin");
  const types = await (await admin.get("/api/admin/membership-types")).json() as { id: string; active: boolean }[];
  const type = types.find((candidate) => candidate.active);
  precondition(type, "the club has an active membership type the acceptance source can default to");
  const tag = Date.now().toString(36);
  const sourceKey = `${IMPORT_SOURCE_PREFIX}${tag}`;
  const rows = [["Jane", "Doe"], ["John", "Roe"], ["Mary", "Major"]]
    .map(([first, last], index) => [`ACC-${tag}-${index + 1}`, first, last, "active"]);
  const columns = rows[0].length;
  const truncated = rows.map((row) => row.slice(0, columns - 1));
  const page = await openAs(browser, "admin");
  let sourceId: string | undefined;
  page.on("response", async (response) => {
    if (!answers("POST", "/api/admin/import/sources")(response) || response.status() !== 201) return;
    const body = await response.json().catch(() => ({})) as { id?: string; sourceKey?: string };
    if (body.id && body.sourceKey === sourceKey) {
      sourceId = body.id;
      recordCreated({ kind: "import-source", id: body.id, by: "admin", project: projectName() });
    }
  });
  try {
    // when
    await step("admin", "describe a headerless source by position", async () => {
      await page.goto("/admin/import");
      await expect(page.getByTestId("admin-import-view")).toBeVisible();
      await page.getByTestId("new-source").click();
      await page.getByTestId("column-mode-POSITION").check();
      await page.getByTestId("source-file").setInputFiles(file("members-headerless.csv", rows));
      await expect(page.getByTestId("column-sample"), "product: the form shows the file's first rows in numbered columns").toBeVisible();
      await expect(page.getByTestId(`sample-column-${columns}`), "product: every column of the file is numbered").toBeVisible();
      await expect(page.getByTestId("source-column-count"), "product: the column count comes from the file").toHaveValue(String(columns));
      await expect(page.getByTestId("sample-header-row"), "product: a member row is not taken for a header").toHaveCount(0);
      await page.getByTestId("source-key").fill(sourceKey);
      await page.getByTestId("source-name").fill(`Acceptance headerless ${tag}`);
      for (const [index, field] of FIELDS.entries()) await page.getByTestId(`position-${field}`).selectOption(String(index + 1));
      await page.getByTestId("source-default-type").selectOption(type.id);
      await capture(page, "import-headerless-source");
      await page.getByTestId("save-source").click();
      await reauthenticateIfAsked(page);
      await expect.poll(() => sourceId, { message: "product: the positional source is stored", timeout: 15_000 }).toBeTruthy();
      const stored = await (await admin.get(`/api/admin/import/sources/${sourceId}`)).json() as
        { columnMode: string; columnCount: number; positions: { position: number; field: string }[] };
      expect(stored.columnMode, "product: the source reads by position").toBe("POSITION");
      expect(stored.columnCount, "product: the source keeps the file's column count").toBe(columns);
      expect(stored.positions, "product: every chosen position is kept")
        .toEqual(expect.arrayContaining(FIELDS.map((field, index) => ({ position: index + 1, field }))));
    });
    // then
    await step("admin", "preview the headerless file", async () => {
      await page.getByTestId("snapshot-mode").selectOption("UPDATE_ONLY");
      await page.getByTestId("snapshot-file").setInputFiles(file("members-headerless.csv", rows));
      const previewed = page.waitForResponse(answers("POST", `/api/admin/import/sources/${sourceId}/previews`));
      await page.getByTestId("upload-snapshot").click();
      const response = await previewed;
      const preview = await response.json().catch(() => ({})) as Preview & Problem;
      expect(response.status(), `product: the headerless file is read (${preview.type ?? ""})`).toBe(201);
      expect(preview.rowCount, "product: the first row is a member, not a header").toBe(rows.length);
      expect(preview.rowErrors, "product: no row of the file is refused").toEqual([]);
      expect(preview.ignoredColumns, "product: the unmapped column is reported by its position").toEqual([String(columns)]);
      expect(preview.changes.map((change) => `${change.kind}:${change.externalId}`).sort(), "product: every row would create a member")
        .toEqual(rows.map((row) => `CREATE:${row[0]}`).sort());
      await expect(page.getByTestId("preview-identity"), "product: the preview names the file").toContainText("members-headerless.csv");
      await page.getByTestId("changes-heading").click();
      for (const row of rows) await expect(page.getByTestId(`change-CREATE-${row[0]}`), `product: the preview lists ${row[0]}`).toBeVisible();
      await capture(page, "import-headerless-preview");
    });
    // when
    await step("admin", "preview an export that lost a column", async () => {
      await page.getByTestId("snapshot-file").setInputFiles(file("members-headerless-truncated.csv", truncated));
      const refused = page.waitForResponse(answers("POST", `/api/admin/import/sources/${sourceId}/previews`));
      await page.getByTestId("upload-snapshot").click();
      const response = await refused;
      const problem = await response.json().catch(() => ({})) as Problem;
      // then
      expect(problem.type, "product: the file is refused as unreadable for this source").toBe("urn:courtside:error:import-snapshot-unreadable");
      expect(problem.violations, "product: the refusal names both column counts")
        .toEqual([{ code: "import.snapshot.columns.countChanged", params: { expected: columns, found: columns - 1 } }]);
      const refusal = page.getByTestId("import-part-preview").getByRole("alert");
      await expect(refusal, "product: the board reads the refusal with both counts at the upload").toContainText(String(columns - 1));
      await capture(page, "import-headerless-refused", { expectedStatuses: [400], subject: refusal });
    });
    // then
    await step("admin", "nothing reached the roster", async () => {
      const runs = await (await admin.get(`/api/admin/import/sources/${sourceId}/runs`)).json() as unknown[];
      expect(runs, "product: no preview of the acceptance source was executed").toEqual([]);
      const { references } = await (await admin.get(`/api/admin/import/sources/${sourceId}/references`)).json() as { references: unknown[] };
      expect(references, "product: the acceptance source links nobody on the roster").toEqual([]);
    });
  } finally {
    await step("admin", "remove the acceptance source", async () => {
      if (sourceId) {
        expect((await adminDelete(admin, `/api/admin/import/sources/${sourceId}`)).status(), "product: the acceptance source is removed").toBe(204);
        expect((await admin.get(`/api/admin/import/sources/${sourceId}`)).status(), "product: the acceptance source is gone").toBe(404);
      }
    });
    await page.context().close();
  }
});
