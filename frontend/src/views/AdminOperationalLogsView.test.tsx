import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ClubConfig, type OperationalLogEntry } from "../api/client";
import i18n from "../i18n";
import { WithClubConfiguration } from "../test/ClubConfiguration";
import { AdminOperationalLogsView } from "./AdminOperationalLogsView";

const club: ClubConfig = {
  clubName: "Example Tennis Club", primaryColor: "#000000", accentColor: "#ffffff",
  logoUrl: null, imprintUrl: null, defaultLocale: "en", supportedLocales: ["de", "en"],
  slotMinutes: 60, timeZone: "Europe/Berlin"
};

const failedRoleUpdate: OperationalLogEntry = {
  id: "11111111-1111-1111-1111-111111111111",
  occurredAt: "2026-09-19T12:00:00Z",
  source: "APPLICATION",
  severity: "ERROR",
  message: "Role update failed",
  traceId: "0123456789abcdef0123456789abcdef"
};

function page(overrides = {}) {
  return {
    entries: [failedRoleUpdate], nextCursor: null, availability: "AVAILABLE" as const,
    retentionTruncated: false, searchIncomplete: false, droppedRecords: 0,
    oldestAvailableAt: "2026-09-19T12:00:00Z", ...overrides
  };
}

function show() {
  render(<WithClubConfiguration club={club}><AdminOperationalLogsView /></WithClubConfiguration>);
}

describe("AdminOperationalLogsView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("shows redacted operational records with their source, severity and trace", async () => {
    vi.spyOn(api, "operationalLogs").mockResolvedValue(page());

    show();

    const row = await screen.findByTestId("operational-log-row");
    expect(screen.getByTestId("operational-logs-provenance-warning"))
      .toHaveTextContent(/reported source is not authenticated/i);
    expect(within(row).getByTestId("operational-log-message")).toHaveTextContent("Role update failed");
    expect(within(row).getByTestId("operational-log-source")).toHaveTextContent("Application");
    expect(within(row).getByTestId("operational-log-severity")).toHaveTextContent("Error");
    expect(within(row).getByTestId("operational-log-trace")).toHaveTextContent("0123456789abcdef0123456789abcdef");
  });

  it("keeps private search criteria in the POST body and applies them together", async () => {
    const search = vi.spyOn(api, "operationalLogs").mockResolvedValue(page());
    show();
    await screen.findByTestId("operational-log-row");

    await userEvent.selectOptions(screen.getByTestId("operational-log-source-filter"), "APPLICATION");
    await userEvent.selectOptions(screen.getByTestId("operational-log-severity-filter"), "ERROR");
    await userEvent.type(screen.getByTestId("operational-log-text-filter"), "role update");
    await userEvent.type(screen.getByTestId("operational-log-trace-filter"), "0123456789abcdef0123456789abcdef");
    await userEvent.click(screen.getByTestId("operational-log-apply"));

    await waitFor(() => expect(search).toHaveBeenLastCalledWith({
      source: "APPLICATION", severity: "ERROR", text: "role update",
      traceId: "0123456789abcdef0123456789abcdef", limit: 50
    }));
  });

  it("interprets the time range in the club time zone", async () => {
    const search = vi.spyOn(api, "operationalLogs").mockResolvedValue(page());
    show();
    await screen.findByTestId("operational-log-row");

    fireEvent.change(screen.getByTestId("operational-log-from-filter"), {
      target: { value: "2026-09-19T14:00" }
    });
    fireEvent.change(screen.getByTestId("operational-log-to-filter"), {
      target: { value: "2026-09-19T15:30" }
    });
    await userEvent.click(screen.getByTestId("operational-log-apply"));

    await waitFor(() => expect(search).toHaveBeenLastCalledWith({
      from: "2026-09-19T14:00:00+02:00",
      to: "2026-09-19T15:30:00+02:00",
      limit: 50
    }));
  });

  it("refuses a wall-clock time that does not exist in the club time zone", async () => {
    const search = vi.spyOn(api, "operationalLogs").mockResolvedValue(page());
    show();
    await screen.findByTestId("operational-log-row");

    fireEvent.change(screen.getByTestId("operational-log-from-filter"), {
      target: { value: "2026-03-29T02:30" }
    });
    await userEvent.click(screen.getByTestId("operational-log-apply"));

    expect(await screen.findByTestId("operational-logs-problem")).toHaveTextContent(
      /does not exist in the club time zone/i
    );
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("distinguishes an unavailable collector from an available empty result", async () => {
    vi.spyOn(api, "operationalLogs").mockResolvedValue(page({
      entries: [], availability: "UNAVAILABLE", oldestAvailableAt: null
    }));

    show();

    expect(await screen.findByTestId("operational-logs-unavailable")).toHaveTextContent(/not available/i);
    expect(screen.queryByTestId("operational-logs-empty")).not.toBeInTheDocument();
  });

  it("reports every completeness limit and continues with the same filters", async () => {
    const search = vi.spyOn(api, "operationalLogs").mockResolvedValue(page({
      nextCursor: "22222222-2222-2222-2222-222222222222",
      retentionTruncated: true, searchIncomplete: true, droppedRecords: 3
    }));
    show();

    expect(await screen.findByTestId("operational-logs-retention-warning")).toBeInTheDocument();
    expect(screen.getByTestId("operational-logs-incomplete-warning")).toBeInTheDocument();
    expect(screen.getByTestId("operational-logs-dropped-warning")).toHaveTextContent("3");
    await userEvent.selectOptions(screen.getByTestId("operational-log-source-filter"), "APPLICATION");
    await userEvent.click(screen.getByTestId("operational-log-apply"));
    await userEvent.click(screen.getByTestId("operational-logs-load-more"));

    await waitFor(() => expect(search).toHaveBeenLastCalledWith({
      source: "APPLICATION", cursor: "22222222-2222-2222-2222-222222222222", limit: 50
    }));
  });
});
