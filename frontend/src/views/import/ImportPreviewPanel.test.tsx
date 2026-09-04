import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ImportPreview } from "../../api/client";
import i18n from "../../i18n";
import { ImportPreviewPanel } from "./ImportPreviewPanel";

const preview: ImportPreview = {
  previewId: "preview-1",
  sourceId: "source-1",
  mode: "UPDATE_ONLY",
  fileName: "members.csv",
  fileHash: "a1b2c3d4e5f6",
  rowCount: 3,
  ignoredColumns: [],
  changes: [
    { kind: "CREATE", rowNumber: 1, externalId: "4711", personId: null, personName: null, values: { FIRST_NAME: "Jane", LAST_NAME: "Doe" }, account: "CREATE" },
    { kind: "UPDATE", rowNumber: 2, externalId: "4712", personId: "person-2", personName: "John Roe", values: { EMAIL: "john.roe@example.org" }, account: "NO_ADDRESS" },
    { kind: "END_MEMBERSHIP", rowNumber: 0, externalId: "4713", personId: "person-3", personName: "Mary Major", values: {}, account: "NOT_ASKED" }
  ],
  rowErrors: [{ rowNumber: 4, code: "import.snapshot.row.externalIdUnusable", params: { maxLength: 120 } }],
  possibleDuplicates: [{ rowNumber: 5, externalId: "4714", personId: "person-4", personName: "Richard Miles" }],
  sharedAddresses: [{ rowNumber: 1, externalId: "4711", sharedBy: 3 }],
  removals: { count: 1, currentlyLinked: 4, percent: 25 },
  needsConfirmation: false,
  superseded: false,
  createdAt: "2026-08-21T10:00:00Z",
  expiresAt: "2026-08-22T10:00:00Z"
};

function show(current: ImportPreview | undefined, previewed = vi.fn(), sourceEncoding = "UTF-8") {
  render(<ImportPreviewPanel
    sourceId="source-1"
    sourceEncoding={sourceEncoding}
    preview={current}
    disabled={false}
    previewed={previewed}
    reportError={vi.fn()}
  />);
}

describe("ImportPreviewPanel", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "supportedEncodings").mockResolvedValue(["ISO-8859-15", "UTF-8", "windows-1252"]);
  });


  it("given a change to a person's data, when the preview lists it, then the field is named the way the rest of the administration names it", async () => {
    // given
    show(preview);

    // when
    const row = await screen.findByTestId("change-CREATE-4711");

    // then
    expect(row).toHaveTextContent("First name: Jane");
    expect(row).toHaveTextContent("Last name: Doe");
    expect(row).not.toHaveTextContent("FIRST_NAME");
    expect(row).not.toHaveTextContent("LAST_NAME");
  });
  it("when nothing is uploaded yet, then a partial list is what an upload would mean", () => {
    // given / when
    show(undefined);

    // then — the default takes nothing away
    expect(screen.getByTestId("snapshot-mode")).toHaveValue("UPDATE_ONLY");
  });

  it("given a chosen file and mode, when it is uploaded, then the preview is asked for", async () => {
    // given
    const previewed = vi.fn();
    const uploading = vi.spyOn(api, "createImportPreview").mockResolvedValue(preview);
    show(undefined, previewed);

    // when
    await userEvent.upload(screen.getByTestId("snapshot-file"),
      new File(["Number;Name\n1;Jane\n"], "members.csv", { type: "text/csv" }));
    await userEvent.selectOptions(screen.getByTestId("snapshot-mode"), "FULL_SNAPSHOT");
    await userEvent.click(screen.getByTestId("upload-snapshot"));

    // then
    expect(uploading).toHaveBeenCalledWith("source-1", expect.any(File), "FULL_SNAPSHOT", "UTF-8");
    expect(previewed).toHaveBeenCalledWith(preview);
  });

  it("given a file that is not UTF-8, when it is chosen, then the encoding is asked for before it is sent", async () => {
    // given
    const uploading = vi.spyOn(api, "createImportPreview").mockResolvedValue(preview);
    show(undefined);

    // when — the file is in the browser, so it can be answered here rather than by the server
    await userEvent.upload(screen.getByTestId("snapshot-file"),
      new File([Uint8Array.from([78, 114, 59, 83, 116, 114, 97, 223, 101, 10])],
        "members.csv", { type: "text/csv" }));

    // then
    expect(await screen.findByTestId("snapshot-not-utf8")).toBeInTheDocument();
    expect(await screen.findByTestId("snapshot-encoding")).toHaveValue("UTF-8");
    await userEvent.clear(screen.getByTestId("snapshot-encoding"));
    await userEvent.type(screen.getByTestId("snapshot-encoding"), "windows-1252");
    await userEvent.click(screen.getByTestId("upload-snapshot"));
    expect(uploading).toHaveBeenCalledWith("source-1", expect.any(File), "UPDATE_ONLY", "windows-1252");
  });

  it("given a source that stores a character set, when a file in it is uploaded, then it is read by that", async () => {
    // given — the source has already been told what its export tool writes
    const uploading = vi.spyOn(api, "createImportPreview").mockResolvedValue(preview);
    show(undefined, vi.fn(), "windows-1252");

    // when — "Nr;Straße" as windows-1252, which strict UTF-8 cannot decode
    await userEvent.upload(screen.getByTestId("snapshot-file"),
      new File([Uint8Array.from([78, 114, 59, 83, 116, 114, 97, 223, 101, 10])],
        "members.csv", { type: "text/csv" }));
    await userEvent.click(screen.getByTestId("upload-snapshot"));

    // then — the answer the club gave once is not asked for again
    expect(screen.queryByTestId("snapshot-not-utf8")).not.toBeInTheDocument();
    expect(uploading).toHaveBeenCalledWith("source-1", expect.any(File), "UPDATE_ONLY", "windows-1252");
  });

  it("given a UTF-8 file, when it is chosen, then no encoding question is put to anybody", async () => {
    // given / when
    show(undefined);
    await userEvent.upload(screen.getByTestId("snapshot-file"),
      new File(["Nr;Straße\n1;Marketplace 9\n"], "members.csv", { type: "text/csv" }));

    // then — a setting nobody needs is a setting nobody should be shown
    expect(screen.queryByTestId("snapshot-encoding")).not.toBeInTheDocument();
  });

  it("given a preview, when it is read, then each section carries its count in the heading", () => {
    // given / when
    show(preview);

    // then
    expect(screen.getByTestId("changes-heading")).toHaveTextContent("3");
    expect(screen.getByTestId("row-errors-heading")).toHaveTextContent("1");
    expect(screen.getByTestId("duplicates-heading")).toHaveTextContent("1");
  });

  it("given an unknown row error, when the preview is read, then a generic failure replaces its translation key", async () => {
    // given
    show({ ...preview, rowErrors: [{ rowNumber: 4, code: "import.snapshot.row.unknown", params: {} }] });

    // when
    await userEvent.click(screen.getByTestId("row-errors-heading"));

    // then
    const error = screen.getByTestId("row-error-4");
    expect(error).toHaveTextContent("That did not work. Please try again.");
    expect(error).not.toHaveTextContent("import.snapshot.row.unknown");
  });

  it("given a change touching somebody the club holds, when it is read, then it names them", async () => {
    // given
    show(preview);

    // when
    await userEvent.click(screen.getByTestId("changes-heading"));

    // then — the riskiest line of the preview must say whose membership ends
    expect(screen.getByTestId("change-END_MEMBERSHIP-4713")).toHaveTextContent("Mary Major");
    expect(screen.getByTestId("change-UPDATE-4712")).toHaveTextContent("John Roe");
  });

  it("given a possible duplicate, when it is read, then it names the person it resembles", async () => {
    // given
    show(preview);

    // when
    await userEvent.click(screen.getByTestId("duplicates-heading"));

    // then
    expect(screen.getByTestId("duplicate-4714")).toHaveTextContent("Richard Miles");
  });

  it("given a preview, when reading it, then each row says what would happen to its account", async () => {
    // given
    show(preview);

    // when
    await userEvent.click(screen.getByTestId("changes-heading"));

    // then
    expect(screen.getByTestId("preview-accounts")).toHaveTextContent("Accounts that would be opened: 1");
    expect(screen.getByTestId("change-CREATE-4711")).toHaveTextContent("an account is opened");
    expect(screen.getByTestId("change-UPDATE-4712")).toHaveTextContent("no email address on file");
    expect(screen.getByTestId("change-END_MEMBERSHIP-4713")).not.toHaveTextContent("account");
  });

  it("given a row whose mailbox several people read, when reading the preview, then it says how many", async () => {
    // given
    show(preview);

    // when
    await userEvent.click(screen.getByTestId("shared-addresses-heading"));

    // then
    expect(screen.getByTestId("shared-addresses-heading")).toHaveTextContent("1");
    expect(screen.getByTestId("shared-address-4711")).toHaveTextContent("3");
  });

  it("given more rows than fit comfortably, when a section is opened, then every one of them is shown", async () => {
    // given
    const many = { ...preview, changes: Array.from({ length: 120 }, (_, index) => ({
      kind: "CREATE" as const, rowNumber: index + 1, externalId: `n${index}`,
      personId: null, personName: null, values: { FIRST_NAME: "Jane", LAST_NAME: "Doe" },
      account: "MEMBERSHIP_TYPE_GRANTS_NONE" as const
    })) };
    show(many);

    // when
    await userEvent.click(screen.getByTestId("changes-heading"));

    // then — a display that shows less than it has without saying so is what this project refuses
    expect(screen.getAllByTestId(/^change-CREATE-/)).toHaveLength(120);
  });

  it("given a superseded preview, when it is read, then it is named rather than hidden", () => {
    // given / when
    show({ ...preview, superseded: true });

    // then
    expect(screen.getByTestId("preview-superseded")).toBeInTheDocument();
    expect(screen.getByTestId("preview-identity")).toHaveTextContent("members.csv");
    expect(screen.getByTestId("preview-identity")).toHaveTextContent("a1b2c3d4e5f6");
  });

  it("given an expired preview, when it is read, then its file is still identified by name and hash", () => {
    // given — past retention the change set is gone; the row, its hash and its counts are not
    show({ ...preview, changes: [], rowErrors: [], possibleDuplicates: [], sharedAddresses: [], expiresAt: "2020-01-01T00:00:00Z" });

    // then
    expect(screen.getByTestId("preview-expired")).toBeInTheDocument();
    expect(screen.getByTestId("preview-identity")).toHaveTextContent("members.csv");
    expect(screen.getByTestId("preview-identity")).toHaveTextContent("a1b2c3d4e5f6");
  });

  it("given a run that would end more than the source allows, when the preview is read, then it says so", () => {
    // given / when
    show({ ...preview, needsConfirmation: true });

    // then
    expect(screen.getByTestId("needs-confirmation")).toBeInTheDocument();
  });

  it("given columns the mapping does not name, when the preview is read, then they are listed", () => {
    // given / when
    show({ ...preview, ignoredColumns: ["IBAN", "Phone"] });

    // then
    expect(screen.getByTestId("preview-ignored-columns")).toHaveTextContent("IBAN");
  });
});
