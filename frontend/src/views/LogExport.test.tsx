import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import * as downloads from "../downloads/downloadJson";
import i18n from "../i18n";
import { LogExport } from "./LogExport";

describe("LogExport", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "importSources").mockResolvedValue([]);
    vi.spyOn(api, "supportedEncodings").mockResolvedValue(["UTF-8", "windows-1252"]);
    vi.spyOn(downloads, "downloadBlob").mockImplementation(() => undefined);
  });

  it("given no period, when the board downloads the audit log, then the whole log is asked for in the chosen format", async () => {
    // given
    const exportAuditLog = vi.spyOn(api, "exportAuditLog").mockResolvedValue({
      fileName: "audit-log-2026-05-12.csv", content: new Blob(["occurredAt"])
    });
    render(<LogExport log="audit" onFailure={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("audit-log-export-encoding")).toHaveValue("UTF-8"));

    // when
    await userEvent.selectOptions(screen.getByTestId("audit-log-export-separator"), ";");
    await userEvent.selectOptions(screen.getByTestId("audit-log-export-encoding"), "windows-1252");
    await userEvent.click(screen.getByTestId("audit-log-export-download"));

    // then
    await waitFor(() => expect(exportAuditLog).toHaveBeenCalledWith({
      from: "", to: "", separator: ";", encoding: "windows-1252"
    }));
    expect(downloads.downloadBlob).toHaveBeenCalledWith("audit-log-2026-05-12.csv", expect.any(Blob));
  });

  it("given a period, when the board downloads the message log, then the request carries that period", async () => {
    // given
    const exportMessageLog = vi.spyOn(api, "exportMessageLog").mockResolvedValue({
      fileName: "message-log-2026-05-12.csv", content: new Blob(["queuedAt"])
    });
    render(<LogExport log="messages" onFailure={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("messages-log-export-encoding")).toHaveValue("UTF-8"));

    // when
    await userEvent.type(screen.getByTestId("messages-log-export-from"), "2026-01-01");
    await userEvent.type(screen.getByTestId("messages-log-export-to"), "2026-03-31");
    await userEvent.click(screen.getByTestId("messages-log-export-download"));

    // then
    await waitFor(() => expect(exportMessageLog).toHaveBeenCalledWith({
      from: "2026-01-01", to: "2026-03-31", separator: ",", encoding: "UTF-8"
    }));
  });

  it("given one configured import source, when the export opens, then its format is offered without being changed", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([
      { separator: ";", encoding: "windows-1252" } as Awaited<ReturnType<typeof api.importSources>>[number]
    ]);

    // when
    render(<LogExport log="audit" onFailure={() => undefined} />);

    // then
    await waitFor(() => expect(screen.getByTestId("audit-log-export-encoding")).toHaveValue("windows-1252"));
    expect(screen.getByTestId("audit-log-export-separator")).toHaveValue(";");
  });

  it("given the instance refuses the period, when the board asks for the file, then the failure is reported", async () => {
    // given
    vi.spyOn(api, "exportAuditLog").mockRejectedValue(new Error("refused"));
    const reported: unknown[] = [];
    render(<LogExport log="audit" onFailure={(failure) => reported.push(failure)} />);
    await waitFor(() => expect(screen.getByTestId("audit-log-export-encoding")).toHaveValue("UTF-8"));

    // when
    await userEvent.type(screen.getByTestId("audit-log-export-from"), "2026-03-31");
    await userEvent.type(screen.getByTestId("audit-log-export-to"), "2026-01-01");
    await userEvent.click(screen.getByTestId("audit-log-export-download"));

    // then
    await waitFor(() => expect(reported).toHaveLength(1));
    expect(downloads.downloadBlob).not.toHaveBeenCalled();
  });
});
