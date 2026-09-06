import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import * as downloads from "../downloads/downloadJson";
import i18n from "../i18n";
import { BookingsExport } from "./BookingsExport";

describe("BookingsExport", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "importSources").mockResolvedValue([]);
    vi.spyOn(api, "supportedEncodings").mockResolvedValue(["UTF-8", "windows-1252"]);
    vi.spyOn(downloads, "downloadBlob").mockImplementation(() => undefined);
  });

  it("given a period a board typed, when it downloads the file, then the request carries that period", async () => {
    // given
    const exportBookings = vi.spyOn(api, "exportBookings").mockResolvedValue({
      fileName: "bookings-2026-01-01-2026-03-31.csv", content: new Blob(["date"])
    });
    render(<BookingsExport onFailure={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("bookings-export-encoding")).toHaveValue("UTF-8"));

    // when
    await userEvent.type(screen.getByTestId("bookings-export-from"), "2026-01-01");
    await userEvent.type(screen.getByTestId("bookings-export-to"), "2026-03-31");
    await userEvent.click(screen.getByTestId("bookings-export-download"));

    // then
    await waitFor(() => expect(exportBookings).toHaveBeenCalledWith({
      from: "2026-01-01", to: "2026-03-31", separator: ",", encoding: "UTF-8"
    }));
    expect(downloads.downloadBlob)
      .toHaveBeenCalledWith("bookings-2026-01-01-2026-03-31.csv", expect.any(Blob));
  });

  it("given the instance refuses the period, when the board asks for it, then the failure is reported", async () => {
    // given
    vi.spyOn(api, "exportBookings").mockRejectedValue(new Error("refused"));
    const reported: unknown[] = [];
    render(<BookingsExport onFailure={(failure) => reported.push(failure)} />);
    await waitFor(() => expect(screen.getByTestId("bookings-export-encoding")).toHaveValue("UTF-8"));

    // when
    await userEvent.type(screen.getByTestId("bookings-export-from"), "2026-03-31");
    await userEvent.type(screen.getByTestId("bookings-export-to"), "2026-01-01");
    await userEvent.click(screen.getByTestId("bookings-export-download"));

    // then
    await waitFor(() => expect(reported).toHaveLength(1));
    expect(downloads.downloadBlob).not.toHaveBeenCalled();
  });
});
