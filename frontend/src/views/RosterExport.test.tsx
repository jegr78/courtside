import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ImportSource } from "../api/client";
import * as downloads from "../downloads/downloadJson";
import i18n from "../i18n";
import { RosterExport } from "./RosterExport";

const membershipSystem: ImportSource = {
  id: "source-1", sourceKey: "membership", displayName: "Membership system", separator: ";",
  encoding: "windows-1252", columns: {}, membershipTypes: {}, defaultMembershipTypeId: "type-1",
  ownedFields: [], removalWarningPercent: 10
};

function offer(): Promise<{ fileName: string; content: Blob }> {
  return Promise.resolve({ fileName: "roster-2026-05-12.csv", content: new Blob(["memberNumber"]) });
}

describe("RosterExport", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "supportedEncodings").mockResolvedValue(["UTF-8", "windows-1252"]);
    vi.spyOn(downloads, "downloadBlob").mockImplementation(() => undefined);
  });

  it("given the club configured an import source, when the panel loads, then it offers what that source reads", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([membershipSystem]);

    // when
    render(<RosterExport disabled={false} onFailure={() => undefined} />);

    // then
    await waitFor(() => expect(screen.getByTestId("roster-export-separator")).toHaveValue(";"));
    expect(screen.getByTestId("roster-export-encoding")).toHaveValue("windows-1252");
    expect(screen.getByTestId("roster-export-source")).toHaveValue("source-1");
  });

  it("given a club that never imported anything, when the panel loads, then no source is offered", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([]);

    // when
    render(<RosterExport disabled={false} onFailure={() => undefined} />);

    // then
    await waitFor(() => expect(screen.getByTestId("roster-export-separator")).toHaveValue(","));
    expect(screen.queryByTestId("roster-export-source")).toBeNull();
  });

  it("given a filtered roster, when the board downloads it, then the file holds what the list shows", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([]);
    const exportRoster = vi.spyOn(api, "exportRoster").mockImplementation(offer);
    render(<RosterExport query="Doe" membershipTypeId="type-1" disabled={false} onFailure={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("roster-export-separator")).toHaveValue(","));

    // when
    await userEvent.click(screen.getByTestId("roster-export-download"));

    // then
    await waitFor(() => expect(exportRoster).toHaveBeenCalledWith({
      query: "Doe", membershipTypeId: "type-1", sourceId: "", separator: ",", encoding: "UTF-8"
    }));
    expect(downloads.downloadBlob).toHaveBeenCalledWith("roster-2026-05-12.csv", expect.any(Blob));
  });

  it("given the instance refuses the export, when the board downloads it, then the failure is reported", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([]);
    vi.spyOn(api, "exportRoster").mockRejectedValue(new Error("refused"));
    const reported: unknown[] = [];
    render(<RosterExport disabled={false} onFailure={(failure) => reported.push(failure)} />);
    await waitFor(() => expect(screen.getByTestId("roster-export-separator")).toHaveValue(","));

    // when
    await userEvent.click(screen.getByTestId("roster-export-download"));

    // then
    await waitFor(() => expect(reported).toHaveLength(1));
    expect(downloads.downloadBlob).not.toHaveBeenCalled();
  });
});
