import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type DoorCode } from "../api/client";
import i18n from "../i18n";
import { AdminDoorCodesView } from "./AdminDoorCodesView";

const doors: DoorCode[] = [
  { accessPointId: "77777777-0000-0000-0000-000000000001", accessPointName: "Clubhouse", staticCode: null, emergencyCode: "908172" },
  { accessPointId: "77777777-0000-0000-0000-000000000002", accessPointName: "Gate", staticCode: "471123", emergencyCode: null }
];

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});

it("given active doors, when the page opens, then each door shows its fixed and emergency code and nothing can be changed", async () => {
  // given
  vi.spyOn(api, "groundsDoorCodes").mockResolvedValue(doors);

  // when
  render(<AdminDoorCodesView />);

  // then
  const rows = await screen.findAllByTestId("door-codes-row");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("Clubhouse");
  expect(screen.getAllByTestId("door-codes-static")[0]).toHaveTextContent("none");
  expect(screen.getAllByTestId("door-codes-emergency")[0]).toHaveTextContent("908172");
  expect(rows[1]).toHaveTextContent("Gate");
  expect(screen.getAllByTestId("door-codes-static")[1]).toHaveTextContent("471123");
  expect(screen.getAllByTestId("door-codes-emergency")[1]).toHaveTextContent("none");
  expect(screen.queryAllByRole("textbox"), "the codes are changed under access points only").toHaveLength(0);
  expect(screen.queryAllByRole("button"), "the codes are changed under access points only").toHaveLength(0);
});

it("given no active door, when the page opens, then it says so", async () => {
  // given
  vi.spyOn(api, "groundsDoorCodes").mockResolvedValue([]);

  // when
  render(<AdminDoorCodesView />);

  // then
  expect(await screen.findByTestId("door-codes-empty")).toHaveTextContent("There is no active door.");
  expect(screen.queryByTestId("door-codes-table")).not.toBeInTheDocument();
});

it("given a refused read, when the page opens, then the failure is shown and no code is", async () => {
  // given
  vi.spyOn(api, "groundsDoorCodes").mockRejectedValue(
    new ApiError(403, { type: "urn:courtside:error:access-denied", title: "Access denied", status: 403 }));

  // when
  render(<AdminDoorCodesView />);

  // then
  expect(await screen.findByTestId("door-codes-error")).toBeInTheDocument();
  expect(screen.queryByTestId("door-codes-table")).not.toBeInTheDocument();
});
