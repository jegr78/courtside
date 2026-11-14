import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import i18n from "../i18n";
import { AdminAccessCodesView } from "./AdminAccessCodesView";

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});

it("given a fixed code and a door with only an emergency code, when the page opens, then each door shows the codes it keeps", async () => {
  // given
  vi.spyOn(api, "accessPointCodes").mockResolvedValue([
    { id: "77777777-0000-0000-0000-000000000001", name: "Clubhouse", staticCode: "135790", emergencyCode: null },
    { id: "77777777-0000-0000-0000-000000000002", name: "Gate", staticCode: null, emergencyCode: "246802" }
  ]);

  // when
  render(<AdminAccessCodesView />);

  // then
  const rows = await screen.findAllByTestId("access-codes-row");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("Clubhouse");
  expect(screen.getAllByTestId("access-codes-static").map((cell) => cell.textContent)).toEqual(["135790", "None"]);
  expect(screen.getAllByTestId("access-codes-emergency").map((cell) => cell.textContent)).toEqual(["None", "246802"]);
  expect(screen.queryByRole("textbox"), "the page changes no code").not.toBeInTheDocument();
  expect(screen.queryByRole("button"), "the page changes no code").not.toBeInTheDocument();
});

it("given no active door, when the page opens, then it says so instead of an empty table", async () => {
  // given
  vi.spyOn(api, "accessPointCodes").mockResolvedValue([]);

  // when
  render(<AdminAccessCodesView />);

  // then
  expect(await screen.findByTestId("access-codes-empty")).toHaveTextContent("No access point is active.");
  expect(screen.queryByTestId("access-codes-table")).not.toBeInTheDocument();
});

it("given the server refuses the read, when the page opens, then the failure is reported and no code is shown", async () => {
  // given
  vi.spyOn(api, "accessPointCodes").mockRejectedValue(new ApiError(403, {
    type: "urn:courtside:error:access-denied", title: "Forbidden", status: 403
  }));

  // when
  render(<AdminAccessCodesView />);

  // then
  expect(await screen.findByTestId("access-codes-error")).toBeInTheDocument();
  expect(screen.queryByTestId("access-codes-table")).not.toBeInTheDocument();
});
