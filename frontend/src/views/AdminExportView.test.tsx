import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import i18n from "../i18n";
import { AdminExportView } from "./AdminExportView";

describe("AdminExportView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "supportedEncodings").mockResolvedValue(["UTF-8"]);
  });

  it("given a board that wants its data out, when the page opens, then both lists are offered", async () => {
    // given
    vi.spyOn(api, "importSources").mockResolvedValue([]);

    // when
    render(<AdminExportView />);

    // then
    await waitFor(() => expect(screen.getByTestId("roster-export")).toBeInTheDocument());
    expect(screen.getByTestId("bookings-export")).toBeInTheDocument();
  });

  it("given the instance cannot say which encodings it has, when the page opens, then the failure is shown", async () => {
    // given
    vi.spyOn(api, "importSources").mockRejectedValue(new Error("refused"));

    // when
    render(<AdminExportView />);

    // then
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
