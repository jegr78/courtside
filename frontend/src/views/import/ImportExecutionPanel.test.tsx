import type { ComponentType, ReactNode } from "react";
import { SecurityKeyFailure } from "../../security/webauthn";
import { proofOwnerHarness } from "../../test/ProofOwner";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type ImportPreview, type ImportRun } from "../../api/client";
import i18n from "../../i18n";
import { ImportExecutionPanel } from "./ImportExecutionPanel";

const preview: ImportPreview = {
  previewId: "preview-1",
  sourceId: "source-1",
  mode: "FULL_SNAPSHOT",
  fileName: "members.csv",
  fileHash: "a1b2c3d4e5f6",
  rowCount: 3,
  ignoredColumns: [],
  changes: [],
  rowErrors: [],
  possibleDuplicates: [],
  sharedAddresses: [],
  removals: { count: 1, currentlyLinked: 4, percent: 25 },
  needsConfirmation: false,
  superseded: false,
  createdAt: "2026-08-21T10:00:00Z",
  expiresAt: "2126-08-22T10:00:00Z"
};

const run: ImportRun = {
  runId: "run-1",
  sourceId: "source-1",
  previewId: "preview-1",
  mode: "FULL_SNAPSHOT",
  fileHash: "a1b2c3d4e5f6",
  created: 12,
  corrected: 3,
  membershipsEnded: 1,
  accountsCreated: 7,
  accountsDisabled: 1,
  rolesRemoved: 0,
  rowErrors: 2,
  removalsConfirmed: false,
  executedAt: "2026-08-21T10:05:00Z"
};

function show(current: ImportPreview | undefined, executed = vi.fn(), timeZone: string | undefined = "Europe/Berlin", wrapper?: ComponentType<{ children: ReactNode }>) {
  return render(<ImportExecutionPanel
    sourceId="source-1"
    preview={current}
    disabled={false}
    timeZone={timeZone}
    executed={executed}
    reportError={vi.fn()}
  />, { wrapper });
}

describe("ImportExecutionPanel", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "importRuns").mockResolvedValue([]);
  });

  it("given a browser in another zone than the club, when a past run is listed, then its time reads in the club's zone", async () => {
    // given — the run happened on 21 August at 10:05 UTC, which is already the 22nd in the club's zone
    vi.spyOn(api, "importRuns").mockResolvedValue([run]);

    // when
    show(preview, vi.fn(), "Pacific/Kiritimati");

    // then
    const entry = await screen.findByTestId("import-run-run-1");
    expect(entry).toHaveTextContent("Aug 22, 2026");
    expect(entry).not.toHaveTextContent("Aug 21, 2026");
  });

  it("given the club's zone is not known yet, when the run log renders, then it names no time at all", async () => {
    // given
    vi.spyOn(api, "importRuns").mockResolvedValue([run]);

    // when — rendered here rather than through the helper, whose default would fill the zone in
    render(<ImportExecutionPanel
      sourceId="source-1"
      preview={preview}
      disabled={false}
      timeZone={undefined}
      executed={vi.fn()}
      reportError={vi.fn()}
    />);

    // then
    expect(await screen.findByTestId("runs-loading")).toHaveTextContent("Earlier runs are being loaded");
    expect(screen.queryByTestId("import-run-run-1")).not.toBeInTheDocument();
  });

  it("given a reviewed preview, when it is executed, then the run is confirmed first", async () => {
    // given
    const executing = vi.spyOn(api, "executeImportPreview").mockResolvedValue(run);
    show(preview);

    // when
    await userEvent.click(await screen.findByTestId("execute-preview"));

    // then — executing cannot be undone by repeating it, so the dialog belongs here
    expect(executing).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByTestId("confirm-execute"));
    expect(executing).toHaveBeenCalledWith("preview-1", false);
  });

  it("given stale authentication, when the password is confirmed, then the exact import is retried", async () => {
    // given
    const executing = vi.spyOn(api, "executeImportPreview")
      .mockRejectedValueOnce(new ApiError(403, {
        type: "urn:courtside:error:recent-authentication-required",
        title: "Recent authentication required",
        status: 403
      }))
      .mockResolvedValueOnce(run);
    const prove = vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
    show({ ...preview, needsConfirmation: true });
    await userEvent.click(await screen.findByTestId("execute-preview"));
    await userEvent.click(await screen.findByTestId("confirm-execute"));

    // when
    await userEvent.type(await screen.findByTestId("import-reauthentication-password"), "current-password");
    await userEvent.click(screen.getByTestId("confirm-import-reauthentication"));

    // then
    expect(prove).toHaveBeenCalledWith("current-password");
    expect(executing).toHaveBeenNthCalledWith(2, "preview-1", true);
    expect(await screen.findByTestId("run-result")).toBeInTheDocument();
  });

  it("given a dismissed security key proof, when the password is confirmed, then the dialog says the key request was cancelled", async () => {
    // given
    const executing = vi.spyOn(api, "executeImportPreview").mockRejectedValue(new ApiError(403, {
      type: "urn:courtside:error:recent-authentication-required",
      title: "Recent authentication required",
      status: 403
    }));
    vi.spyOn(api, "reauthenticate").mockRejectedValue(new SecurityKeyFailure("dismissed", "NotAllowedError"));
    show(preview);
    await userEvent.click(await screen.findByTestId("execute-preview"));
    await userEvent.click(await screen.findByTestId("confirm-execute"));

    // when
    await userEvent.type(await screen.findByTestId("import-reauthentication-password"), "current-password");
    await userEvent.click(screen.getByTestId("confirm-import-reauthentication"));

    // then
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(i18n.t("mfa.keyCancelled"));
    expect(executing).toHaveBeenCalledOnce();
  });

  it("given a run that ends more than the source allows, when it is executed, then removals are confirmed explicitly", async () => {
    // given
    const executing = vi.spyOn(api, "executeImportPreview").mockResolvedValue(run);
    show({ ...preview, needsConfirmation: true });

    // when
    const execute = await screen.findByTestId("execute-preview");
    expect(execute).toHaveClass("button-destructive");
    await userEvent.click(execute);

    // then
    expect(await screen.findByTestId("confirm-removals-note")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-execute"), "the confirmation carries the full destructive weight").toHaveClass("button-destructive-confirm");
    await userEvent.click(screen.getByTestId("confirm-execute"));
    expect(executing).toHaveBeenCalledWith("preview-1", true);
  });

  it("given a superseded preview, when the panel is read, then it cannot be executed at all", async () => {
    // given / when
    show({ ...preview, superseded: true });

    // then
    expect(await screen.findByTestId("not-executable")).toBeInTheDocument();
    expect(screen.queryByTestId("execute-preview")).not.toBeInTheDocument();
  });

  it("given an expired preview, when the panel is read, then it cannot be executed either", async () => {
    // given / when
    show({ ...preview, expiresAt: "2020-01-01T00:00:00Z" });

    // then
    expect(await screen.findByTestId("not-executable")).toBeInTheDocument();
    expect(screen.queryByTestId("execute-preview")).not.toBeInTheDocument();
  });

  it("given a finished run, when its result is read, then every number it carries is named", async () => {
    // given
    vi.spyOn(api, "executeImportPreview").mockResolvedValue(run);
    show(preview);
    await userEvent.click(await screen.findByTestId("execute-preview"));

    // when
    await userEvent.click(await screen.findByTestId("confirm-execute"));

    // then — a result that reports only what went well is a result nobody can act on
    const result = await screen.findByTestId("run-result");
    expect(result).toHaveRole("status");
    expect(result).toHaveTextContent("12");
    expect(result).toHaveTextContent("3");
    expect(result).toHaveTextContent("1");
    expect(result).toHaveTextContent("2");
    expect(screen.getByTestId("run-result-created")).toBeInTheDocument();
    expect(screen.getByTestId("run-result-corrected")).toBeInTheDocument();
    expect(screen.getByTestId("run-result-membershipsEnded")).toBeInTheDocument();
    expect(screen.getByTestId("run-result-accountsDisabled")).toBeInTheDocument();
    expect(screen.getByTestId("run-result-rolesRemoved")).toBeInTheDocument();
    expect(screen.getByTestId("run-result-rowErrors")).toBeInTheDocument();
  });

  it("given earlier runs, when the panel opens, then each is listed with what it did", async () => {
    // given
    vi.spyOn(api, "importRuns").mockResolvedValue([run]);

    // when
    show(undefined);

    // then
    expect(await screen.findByTestId("import-run-run-1")).toHaveTextContent("12");
  });

  it("given a source that has never been run, when the panel opens, then it says so", async () => {
    // given / when
    show(undefined);

    // then
    expect(await screen.findByTestId("no-runs")).toHaveTextContent(
      "Completed imports and their results appear here. Select a CSV file above to preview and run the first import."
    );
  });

  it("given a finished run, when it is done, then the log holds it without a reload", async () => {
    // given
    vi.spyOn(api, "executeImportPreview").mockResolvedValue(run);
    show(preview);
    await screen.findByTestId("no-runs");

    // when
    await userEvent.click(screen.getByTestId("execute-preview"));
    await userEvent.click(await screen.findByTestId("confirm-execute"));

    // then
    expect(await screen.findByTestId("import-run-run-1")).toBeInTheDocument();
  });
  it.each(["escape", "unmount", "account switch"])("given a proof awaiting its response, when %s invalidates its dialog, then never send the saved mutation", async (ending) => {
    // given
    const owner = proofOwnerHarness();
    let proved!: () => void;
    vi.spyOn(api, "reauthenticate").mockReturnValue(new Promise((resolve) => { proved = resolve; }));
    const changing = vi.spyOn(api, "executeImportPreview").mockRejectedValueOnce(new ApiError(403, { type: "urn:courtside:error:recent-authentication-required", title: "Proof required", status: 403 })).mockResolvedValue(run);
    const shown = show(preview, undefined, undefined, owner.Wrapper);
    await userEvent.click(await screen.findByTestId("execute-preview"));
    await userEvent.click(await screen.findByTestId("confirm-execute"));
    await userEvent.type(await screen.findByTestId("import-reauthentication-password"), "current-password");
    await userEvent.click(screen.getByTestId("confirm-import-reauthentication"));
    // when
    if (ending === "escape") {
      await userEvent.click(screen.getByRole("dialog").querySelector("input")!);
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
    }
    else if (ending === "unmount") shown.unmount();
    else act(owner.change);
    await act(async () => { proved(); await Promise.resolve(); });
    // then
    expect(changing).toHaveBeenCalledOnce();
  });

});
