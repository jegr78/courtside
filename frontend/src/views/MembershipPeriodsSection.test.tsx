import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type MembershipPeriod, type MembershipType } from "../api/client";
import i18n from "../i18n";
import { MembershipPeriodsSection } from "./MembershipPeriodsSection";

const adults: MembershipType = { id: "type-1", name: "Adults", ruleSetId: null, active: true, grantsAccount: false };
const juniors: MembershipType = { id: "type-2", name: "Juniors", ruleSetId: null, active: true, grantsAccount: false };

const ended: MembershipPeriod = { id: "period-1", membershipTypeId: "type-2", startedOn: "2020-01-01", endedOn: "2021-01-01", state: "ENDED" };
const running: MembershipPeriod = { id: "period-2", membershipTypeId: "type-1", startedOn: "2021-01-01", endedOn: null, state: "RUNNING" };
const scheduled: MembershipPeriod = { id: "period-3", membershipTypeId: "type-2", startedOn: "2999-01-01", endedOn: null, state: "SCHEDULED" };

const overlap = new ApiError(409, {
  type: "urn:courtside:error:membership-periods-overlap", title: "Membership periods overlap", status: 409,
  violations: [{ code: "membershipPeriod.overlaps", params: {} }]
});

function show(changed = vi.fn()) {
  render(<MembershipPeriodsSection personId="person-1" types={[adults, juniors]} disabled={false} version="0" changed={changed} />);
  return changed;
}

describe("MembershipPeriodsSection", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  afterEach(cleanup);

  it("given periods that ended, run and begin later, when the section is shown, then each carries its state", async () => {
    // given
    vi.spyOn(api, "membershipPeriods").mockResolvedValue([ended, running, scheduled]);

    // when
    show();

    // then
    const list = await screen.findByTestId("membership-periods-list");
    expect(within(list).getAllByRole("listitem"), "every period is listed in the order the server gave").toHaveLength(3);
    expect(screen.getByTestId("membership-period-state-period-1")).toHaveAttribute("data-state", "ended");
    expect(screen.getByTestId("membership-period-state-period-2")).toHaveAttribute("data-state", "running");
    expect(screen.getByTestId("membership-period-state-period-3"), "a period that begins later is not running yet")
      .toHaveAttribute("data-state", "scheduled");
    expect(screen.getByTestId("membership-period-period-3")).toHaveTextContent("Juniors");
    expect(screen.getByTestId("membership-period-period-3")).toHaveTextContent("Jan 1, 2999");
  });

  it("given dates the browser's calendar would read otherwise, when the section is shown, then the state the server gives on the club's day stands", async () => {
    // given
    vi.spyOn(api, "membershipPeriods").mockResolvedValue([
      { ...running, endedOn: "2999-01-01", state: "ENDED" },
      { ...scheduled, id: "period-4", startedOn: "2000-01-01", endedOn: "2000-06-01", state: "SCHEDULED" },
    ]);

    // when
    show();

    // then
    expect(await screen.findByTestId("membership-period-state-period-2"), "a period ended on the club's day is ended")
      .toHaveAttribute("data-state", "ended");
    expect(screen.getByTestId("membership-period-state-period-4"), "a period not yet begun on the club's day is scheduled")
      .toHaveAttribute("data-state", "scheduled");
  });

  it("given a person without periods, when a period beginning in the future is added, then it is sent whole and the list is read again", async () => {
    // given
    const periods = vi.spyOn(api, "membershipPeriods").mockResolvedValueOnce([]).mockResolvedValueOnce([scheduled]);
    const adding = vi.spyOn(api, "addMembershipPeriod").mockResolvedValue(scheduled);
    const changed = show();
    await screen.findByTestId("membership-periods-none");

    // when
    await userEvent.click(screen.getByTestId("add-period"));
    await userEvent.selectOptions(screen.getByTestId("period-type"), "type-2");
    await userEvent.type(screen.getByTestId("period-started-on"), "2999-01-01");
    await userEvent.click(screen.getByTestId("save-period"));

    // then
    expect(adding).toHaveBeenCalledWith("person-1", { membershipTypeId: "type-2", startedOn: "2999-01-01", endedOn: null });
    expect(await screen.findByTestId("membership-period-state-period-3")).toHaveAttribute("data-state", "scheduled");
    expect(periods).toHaveBeenCalledTimes(2);
    expect(changed, "the person's own membership fields are read again").toHaveBeenCalled();
    expect(screen.queryByRole("dialog"), "the form closes once saved").not.toBeInTheDocument();
  });

  it("given an overlapping period, when it is added, then the form stays open and names the overlap", async () => {
    // given
    vi.spyOn(api, "membershipPeriods").mockResolvedValue([running]);
    vi.spyOn(api, "addMembershipPeriod").mockRejectedValue(overlap);
    const changed = show();
    await screen.findByTestId("membership-periods-list");

    // when
    await userEvent.click(screen.getByTestId("add-period"));
    await userEvent.selectOptions(screen.getByTestId("period-type"), "type-2");
    await userEvent.type(screen.getByTestId("period-started-on"), "2022-01-01");
    await userEvent.click(screen.getByTestId("save-period"));

    // then
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert"), "the refusal is told by its own message")
      .toHaveTextContent(i18n.t("membershipPeriod.overlaps"));
    expect(changed).not.toHaveBeenCalled();
  });

  it("given a running period, when it is corrected, then type and both dates go to that period", async () => {
    // given
    vi.spyOn(api, "membershipPeriods").mockResolvedValue([running]);
    const correcting = vi.spyOn(api, "correctMembershipPeriod").mockResolvedValue({ ...running, endedOn: "2999-06-01" });
    show();
    await userEvent.click(await screen.findByTestId("correct-period-period-2"));

    // when
    expect(screen.getByTestId("period-type"), "the form starts from the stored period").toHaveValue("type-1");
    expect(screen.getByTestId("period-started-on")).toHaveValue("01/01/2021");
    await userEvent.type(screen.getByTestId("period-ended-on"), "2999-06-01");
    await userEvent.click(screen.getByTestId("save-period"));

    // then
    expect(correcting).toHaveBeenCalledWith("person-1", "period-2",
      { membershipTypeId: "type-1", startedOn: "2021-01-01", endedOn: "2999-06-01" });
  });

  it("when the end date is read, then it says it is the first day without the membership", async () => {
    // given
    vi.spyOn(api, "membershipPeriods").mockResolvedValue([]);
    show();
    await userEvent.click(await screen.findByTestId("add-period"));

    // when
    const end = screen.getByTestId("period-ended-on");

    // then
    expect(end).toHaveAccessibleDescription(expect.stringContaining(i18n.t("admin.person.endedOnHint")));
  });

  it("given a period, when its removal is confirmed, then that period is removed and the list is read again", async () => {
    // given
    vi.spyOn(api, "membershipPeriods").mockResolvedValueOnce([ended, running]).mockResolvedValueOnce([running]);
    const removing = vi.spyOn(api, "removeMembershipPeriod").mockResolvedValue(undefined);
    show();
    await userEvent.click(await screen.findByTestId("remove-period-period-1"));

    // when
    await userEvent.click(screen.getByTestId("confirm-remove-period"));

    // then
    expect(removing).toHaveBeenCalledWith("person-1", "period-1");
    await waitFor(() => expect(screen.queryByTestId("membership-period-period-1")).not.toBeInTheDocument());
  });

  it("given a removal is only asked for, when it is cancelled, then nothing is removed", async () => {
    // given
    vi.spyOn(api, "membershipPeriods").mockResolvedValue([running]);
    const removing = vi.spyOn(api, "removeMembershipPeriod");
    show();
    await userEvent.click(await screen.findByTestId("remove-period-period-2"));

    // when
    await userEvent.click(screen.getByTestId("cancel-remove-period"));

    // then
    expect(removing).not.toHaveBeenCalled();
    expect(screen.getByTestId("membership-period-period-2")).toBeInTheDocument();
  });

  it("given closed and open calendar ranges, when the language changes, then the displayed dates follow the locale", async () => {
    // given
    vi.spyOn(api, "membershipPeriods").mockResolvedValue([ended, running]);
    await i18n.changeLanguage("en");
    show();
    const entry = await screen.findByTestId("membership-period-period-1");
    expect(entry).toHaveTextContent("Jan 1, 2020");
    expect(entry).toHaveTextContent("Jan 1, 2021");

    // when
    await act(() => i18n.changeLanguage("de"));

    // then
    expect(entry).toHaveTextContent("01.01.2020");
    expect(entry).toHaveTextContent("01.01.2021");
    expect(screen.getByTestId("membership-period-period-2")).toHaveTextContent("01.01.2021");
  });
});
