import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api, type ImportSource, type MembershipType } from "../api/client";
import i18n from "../i18n";
import { AdminImportView } from "./AdminImportView";

const adults: MembershipType = { id: "type-1", name: "Adults", ruleSetId: null, active: true };

const rosterSystem: ImportSource = {
  id: "source-1",
  sourceKey: "roster-system",
  displayName: "Membership system",
  columns: { "Member number": "EXTERNAL_ID", "First name": "FIRST_NAME", "Last name": "LAST_NAME" },
  membershipTypes: {},
  defaultMembershipTypeId: "type-1",
  ownedFields: [],
  removalWarningPercent: 10
};

const clubRegistry: ImportSource = { ...rosterSystem, id: "source-2", sourceKey: "club-registry", displayName: "Club registry" };

function show() {
  render(<MemoryRouter><AdminImportView /></MemoryRouter>);
}

describe("AdminImportView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "membershipTypes").mockResolvedValue([adults]);
    vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [], nextCursor: null });
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

  it("given the sources cannot be read, when the view opens, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "importSources").mockRejectedValue(new Error("unavailable"));

    // when
    show();

    // then
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
