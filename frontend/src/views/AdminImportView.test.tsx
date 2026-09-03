import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api, type ImportSource, type MembershipType } from "../api/client";
import i18n from "../i18n";
import { UnsavedChangesProvider } from "../unsaved/UnsavedChangesProvider";
import { AdminImportView } from "./AdminImportView";

const adults: MembershipType = { id: "type-1", name: "Adults", ruleSetId: null, active: true, grantsAccount: false };

const rosterSystem: ImportSource = {
  id: "source-1",
  sourceKey: "roster-system",
  displayName: "Membership system", separator: ";", encoding: "UTF-8",
  columns: { "Member number": "EXTERNAL_ID", "First name": "FIRST_NAME", "Last name": "LAST_NAME" },
  membershipTypes: {},
  defaultMembershipTypeId: "type-1",
  ownedFields: [],
  removalWarningPercent: 10
};

const clubRegistry: ImportSource = { ...rosterSystem, id: "source-2", sourceKey: "club-registry", displayName: "Club registry" };

function show() {
  render(<MemoryRouter><UnsavedChangesProvider><AdminImportView /></UnsavedChangesProvider></MemoryRouter>);
}

describe("AdminImportView", () => {
  it("when the page is shown, then its content keeps a readable line length", () => {
    // when
    show();

    // then
    expect(screen.getByTestId("admin-import-view")).toHaveClass("[&>*]:max-w-5xl");
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "membershipTypes").mockResolvedValue([adults]);
    vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [], nextCursor: null });
    vi.spyOn(api, "importRuns").mockResolvedValue([]);
  });

  it("given a club with sources, when the view opens, then each one can be chosen", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([rosterSystem, clubRegistry]);

    // when
    show();

    // then
    expect(await screen.findByTestId("source-choice-source-1")).toBeInTheDocument();
    expect(screen.getByTestId("source-choice-source-2")).toBeInTheDocument();
  });

  it("given a club with no source yet, when the view opens, then it says so and offers to add one", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([]);

    // when
    show();

    // then
    expect(await screen.findByTestId("no-sources")).toBeInTheDocument();
    expect(screen.getByTestId("new-source")).toBeInTheDocument();
  });

  it("given a described source being edited, when the language changes, then the sources are not fetched again", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([rosterSystem]);
    show();
    await userEvent.click(await screen.findByTestId("source-choice-source-1"));
    await userEvent.type(await screen.findByTestId("source-name"), " export");

    // when
    await act(() => i18n.changeLanguage("de"));

    // then
    expect(screen.getByTestId("new-source")).toHaveTextContent("Neue Quelle");
    expect(api.importSources).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("source-name")).toHaveValue("Membership system export");
  });

  it("given a chosen source, when its name is corrected, then the change is written to that source", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([rosterSystem]);
    const changing = vi.spyOn(api, "changeImportSource")
      .mockResolvedValue({ ...rosterSystem, displayName: "Corrected" });
    show();
    await userEvent.click(await screen.findByTestId("source-choice-source-1"));

    // when
    await userEvent.clear(await screen.findByTestId("source-name"));
    await userEvent.type(screen.getByTestId("source-name"), "Corrected");
    await userEvent.click(screen.getByTestId("save-source"));

    // then
    expect(changing).toHaveBeenCalledWith("source-1", expect.objectContaining({ displayName: "Corrected" }));
  });

  it("when a source is added, then it is created and joins the list", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([]);
    const creating = vi.spyOn(api, "createImportSource").mockResolvedValue(rosterSystem);
    show();

    // when
    await userEvent.click(await screen.findByTestId("new-source"));
    await userEvent.type(await screen.findByTestId("source-key"), "roster-system");
    await userEvent.type(screen.getByTestId("source-name"), "Membership system");
    await userEvent.click(screen.getByTestId("save-source"));

    // then
    expect(creating).toHaveBeenCalledWith(expect.objectContaining({ sourceKey: "roster-system" }));
    expect(await screen.findByTestId("source-choice-source-1")).toBeInTheDocument();
  });

  it("given a source that is no longer used, when it is removed, then the removal is confirmed first", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([rosterSystem]);
    const removing = vi.spyOn(api, "deleteImportSource").mockResolvedValue(undefined);
    show();
    await userEvent.click(await screen.findByTestId("source-choice-source-1"));

    // when
    await userEvent.click(await screen.findByTestId("remove-source"));

    // then — the dialog stands between the click and the call
    expect(removing).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByTestId("confirm-remove-source"));
    expect(removing).toHaveBeenCalledWith("source-1");
    expect(screen.queryByTestId("source-choice-source-1")).not.toBeInTheDocument();
  });

  it("given a chosen source, when it is opened, then its linked member numbers are shown with it", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([rosterSystem]);

    // when
    show();
    await userEvent.click(await screen.findByTestId("source-choice-source-1"));

    // then
    expect(await screen.findByTestId("no-references")).toBeInTheDocument();
  });

  it("given a finished run, when it created people, then the linked numbers are read again", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([rosterSystem]);
    const reading = vi.spyOn(api, "externalReferences")
      .mockResolvedValue({ references: [], nextCursor: null });
    vi.spyOn(api, "createImportPreview").mockResolvedValue({
      previewId: "preview-1", sourceId: "source-1", mode: "UPDATE_ONLY", fileName: "members.csv",
      fileHash: "abc", rowCount: 1, ignoredColumns: [], changes: [], rowErrors: [],
      possibleDuplicates: [], sharedAddresses: [], removals: { count: 0, currentlyLinked: 0, percent: 0 },
      needsConfirmation: false, superseded: false,
      createdAt: "2026-08-21T10:00:00Z", expiresAt: "2126-08-22T10:00:00Z"
    });
    vi.spyOn(api, "executeImportPreview").mockResolvedValue({
      runId: "run-1", sourceId: "source-1", previewId: "preview-1", mode: "UPDATE_ONLY",
      fileHash: "abc", created: 4, corrected: 0, membershipsEnded: 0, accountsCreated: 0,
      accountsDisabled: 0,
      rolesRemoved: 0, rowErrors: 0, removalsConfirmed: false, executedAt: "2026-08-21T10:05:00Z"
    });
    show();
    await userEvent.click(await screen.findByTestId("source-choice-source-1"));
    await screen.findByTestId("no-references");
    const before = reading.mock.calls.length;

    // when
    await userEvent.upload(screen.getByTestId("snapshot-file"),
      new File(["Number;Name\n1;Jane\n"], "members.csv", { type: "text/csv" }));
    await userEvent.click(screen.getByTestId("upload-snapshot"));
    await userEvent.click(await screen.findByTestId("execute-preview"));
    await userEvent.click(await screen.findByTestId("confirm-execute"));

    // then — a run links everybody it created, so the panel beside it is stale the moment it ends
    await vi.waitFor(() => expect(reading.mock.calls.length).toBeGreaterThan(before));
  });

  it("given the sources cannot be read, when the view opens, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "importSources").mockRejectedValue(new Error("unavailable"));

    // when
    show();

    // then
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("given a described source is edited, when another source is opened, then the edit is not dropped silently", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([rosterSystem, clubRegistry]);
    render(<MemoryRouter><UnsavedChangesProvider><AdminImportView /></UnsavedChangesProvider></MemoryRouter>);
    await userEvent.click(await screen.findByTestId("source-choice-source-1"));
    await userEvent.type(await screen.findByTestId("source-name"), " plus");

    // when
    await userEvent.click(screen.getByTestId("source-choice-source-2"));

    // then
    expect(await screen.findByTestId("unsaved-changes")).toBeInTheDocument();
    expect(screen.getByTestId("source-name")).toHaveValue("Membership system plus");

    // when
    await userEvent.click(screen.getByTestId("unsaved-changes-stay"));

    // then
    expect(screen.queryByTestId("unsaved-changes")).not.toBeInTheDocument();
    expect(screen.getByTestId("source-name")).toHaveValue("Membership system plus");

    // when
    await userEvent.click(screen.getByTestId("source-choice-source-2"));
    await userEvent.click(await screen.findByTestId("unsaved-changes-discard"));

    // then
    await waitFor(() => expect(screen.getByTestId("source-name")).toHaveValue("Club registry"));
  });

  it("given a source with nothing edited, when another source is opened, then it opens without a question", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([rosterSystem, clubRegistry]);
    render(<MemoryRouter><UnsavedChangesProvider><AdminImportView /></UnsavedChangesProvider></MemoryRouter>);
    await userEvent.click(await screen.findByTestId("source-choice-source-1"));
    await screen.findByTestId("source-name");

    // when
    await userEvent.click(screen.getByTestId("source-choice-source-2"));

    // then
    await waitFor(() => expect(screen.getByTestId("source-name")).toHaveValue("Club registry"));
    expect(screen.queryByTestId("unsaved-changes")).not.toBeInTheDocument();
  });

  it("given a described source is edited, when the same source is chosen again, then nothing is asked", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([rosterSystem, clubRegistry]);
    render(<MemoryRouter><UnsavedChangesProvider><AdminImportView /></UnsavedChangesProvider></MemoryRouter>);
    await userEvent.click(await screen.findByTestId("source-choice-source-1"));
    await userEvent.type(await screen.findByTestId("source-name"), " plus");

    // when
    await userEvent.click(screen.getByTestId("source-choice-source-1"));

    // then
    expect(screen.queryByTestId("unsaved-changes")).not.toBeInTheDocument();
    expect(screen.getByTestId("source-name")).toHaveValue("Membership system plus");
  });

  it("given a member number typed for a link, when another source is opened, then the link is asked about", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([rosterSystem, clubRegistry]);
    vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [], nextCursor: null });
    render(<MemoryRouter><UnsavedChangesProvider><AdminImportView /></UnsavedChangesProvider></MemoryRouter>);
    await userEvent.click(await screen.findByTestId("source-choice-source-1"));
    await userEvent.type(await screen.findByTestId("reference-external-id"), "4711");

    // when
    await userEvent.click(screen.getByTestId("source-choice-source-2"));

    // then
    expect(await screen.findByTestId("unsaved-changes")).toBeInTheDocument();
  });

  it("given a source being described for the first time, when another is opened, then it is asked about", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([rosterSystem]);
    render(<MemoryRouter><UnsavedChangesProvider><AdminImportView /></UnsavedChangesProvider></MemoryRouter>);
    await userEvent.click(await screen.findByTestId("new-source"));
    await userEvent.type(await screen.findByTestId("source-name"), "Club registry");

    // when
    await userEvent.click(screen.getByTestId("source-choice-source-1"));

    // then
    expect(await screen.findByTestId("unsaved-changes")).toBeInTheDocument();
    expect(screen.getByTestId("source-name")).toHaveValue("Club registry");
  });
});
