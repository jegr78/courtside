import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type GuardianRelationship, type RosterEntry } from "../api/client";
import i18n from "../i18n";
import { GuardianshipsSection } from "./GuardianshipsSection";

const person = (personId: string, firstName: string, lastName: string, accountId: string | null = `account-${personId}`) =>
  ({ personId, firstName, lastName, email: null, accountId, roles: [] }) as unknown as RosterEntry;

const jane = person("person-1", "Jane", "Doe");
const john = person("person-2", "John", "Roe");
const mary = person("person-3", "Mary", "Major");
const richard = person("person-4", "Richard", "Miles", null);

const party = (entry: RosterEntry) => ({ personId: entry.personId, firstName: entry.firstName, lastName: entry.lastName });

const actingForJohn: GuardianRelationship = {
  id: "relationship-1", guardian: party(jane), dependant: party(john), grants: ["BOOK", "VIEW_BOOKINGS"],
  startedOn: "2026-10-01", endedOn: null, state: "RUNNING"
};
const actedForByMary: GuardianRelationship = {
  id: "relationship-2", guardian: party(mary), dependant: party(jane), grants: ["READ_MESSAGES"],
  startedOn: "2025-01-01", endedOn: "2025-06-01", state: "ENDED"
};

const refused = (type: string, status: number, code?: string) => new ApiError(status, {
  type: `urn:courtside:error:${type}`, title: type, status,
  ...(code ? { violations: [{ code, params: {} }] } : {})
});

function show(stepUp = vi.fn()) {
  render(<GuardianshipsSection entry={jane} disabled={false} stepUp={stepUp} />);
  return stepUp;
}

async function chooseJohnAsDependant() {
  await userEvent.click(screen.getByTestId("add-guardianship"));
  await userEvent.click(screen.getByTestId("guardianship-as-guardian"));
  await userEvent.type(screen.getByTestId("guardianship-search"), "Ro");
  await userEvent.click(await screen.findByTestId("guardianship-match"));
  await userEvent.click(screen.getByTestId("guardianship-grant-VIEW_BOOKINGS"));
  await userEvent.click(screen.getByTestId("guardianship-grant-BOOK"));
}

describe("GuardianshipsSection", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  afterEach(cleanup);

  it("given relationships in both directions, when the section is shown, then each names the other person, its actions and its state", async () => {
    // given
    vi.spyOn(api, "guardianRelationships").mockResolvedValue([actingForJohn, actedForByMary]);

    // when
    show();

    // then
    const acting = await screen.findByTestId("guardianship-relationship-1");
    expect(acting).toHaveTextContent("acts for John Roe");
    expect(acting).toHaveAttribute("data-state", "running");
    expect(within(screen.getByTestId("guardianship-grants-relationship-1")).getAllByRole("listitem")
      .map((item) => item.getAttribute("data-grant")), "the actions are listed in the fixed order").toEqual(["VIEW_BOOKINGS", "BOOK"]);
    const actedFor = screen.getByTestId("guardianship-relationship-2");
    expect(actedFor).toHaveTextContent("is represented by Mary Major");
    expect(actedFor).toHaveAttribute("data-state", "ended");
    expect(actedFor).toHaveTextContent("ending on Jun 1, 2025");
    expect(screen.queryByTestId("end-guardianship-relationship-2"), "an ended relationship cannot be ended again").toBeNull();
  });

  it("given a person acting for nobody, when the board links them as guardian of someone with an account, then the pair, the actions and the end are sent and the list is read again", async () => {
    // given
    const read = vi.spyOn(api, "guardianRelationships").mockResolvedValueOnce([]).mockResolvedValueOnce([actingForJohn]);
    const search = vi.spyOn(api, "roster").mockResolvedValue({ entries: [jane, john, richard], matching: 3 });
    const create = vi.spyOn(api, "createGuardianRelationship").mockResolvedValue(actingForJohn);
    show();
    await screen.findByTestId("guardianships-none");

    // when
    await chooseJohnAsDependant();
    await userEvent.type(screen.getByTestId("guardianship-ended-on"), "2030-09-01");
    await userEvent.click(screen.getByTestId("save-guardianship"));

    // then
    expect(search).toHaveBeenCalledWith({ query: "Ro", limit: 10 });
    expect(create).toHaveBeenCalledWith("person-1", {
      guardianPersonId: "person-1", dependantPersonId: "person-2", grants: ["VIEW_BOOKINGS", "BOOK"], endedOn: "2030-09-01"
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("guardianship-success")).toHaveTextContent("The guardianship was saved.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("given a search, when the matches arrive, then neither the person themself nor anyone without an account can be chosen", async () => {
    // given
    vi.spyOn(api, "guardianRelationships").mockResolvedValue([]);
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [jane, john, richard], matching: 3 });
    show();
    await screen.findByTestId("guardianships-none");

    // when
    await userEvent.click(screen.getByTestId("add-guardianship"));
    await userEvent.type(screen.getByTestId("guardianship-search"), "Do");

    // then
    const offered = await screen.findAllByTestId("guardianship-match");
    expect(offered.map((match) => match.getAttribute("data-person-id"))).toEqual(["person-2"]);
  });

  it("given the pair already stands the other way round, when the board saves, then the form stays open and says why", async () => {
    // given
    vi.spyOn(api, "guardianRelationships").mockResolvedValue([]);
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [john], matching: 1 });
    vi.spyOn(api, "createGuardianRelationship").mockRejectedValue(
      refused("invalid-guardian-relationship", 400, "guardianship.reversed"));
    show();
    await screen.findByTestId("guardianships-none");

    // when
    await chooseJohnAsDependant();
    await userEvent.click(screen.getByTestId("save-guardianship"));

    // then
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("The dependant already acts for this guardian, so the two cannot be each other's guardians.");
  });

  it("given the guardian already acts for the dependant, when the board saves, then the overlap is named", async () => {
    // given
    vi.spyOn(api, "guardianRelationships").mockResolvedValue([]);
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [john], matching: 1 });
    vi.spyOn(api, "createGuardianRelationship").mockRejectedValue(
      refused("guardian-relationship-overlap", 409, "guardianship.overlaps"));
    show();
    await screen.findByTestId("guardianships-none");

    // when
    await chooseJohnAsDependant();
    await userEvent.click(screen.getByTestId("save-guardianship"));

    // then
    expect(within(await screen.findByRole("dialog")).getByRole("alert"))
      .toHaveTextContent("This guardian already holds a relationship to this dependant on these days.");
  });

  it("given a sign-in too old for the write, when the board saves, then the page asks for the password and the retry writes and reads the list", async () => {
    // given
    const read = vi.spyOn(api, "guardianRelationships").mockResolvedValueOnce([]).mockResolvedValueOnce([actingForJohn]);
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [john], matching: 1 });
    const create = vi.spyOn(api, "createGuardianRelationship")
      .mockRejectedValueOnce(refused("recent-authentication-required", 403))
      .mockResolvedValueOnce(actingForJohn);
    const stepUp = show();
    await screen.findByTestId("guardianships-none");
    await chooseJohnAsDependant();

    // when
    await userEvent.click(screen.getByTestId("save-guardianship"));

    // then
    expect(stepUp, "the proof is asked for by the page that holds the password dialog").toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("dialog")).queryByRole("alert"), "a missing proof is not shown as a refusal").toBeNull();
    const retry = stepUp.mock.calls[0][0] as () => Promise<void>;
    await retry();
    expect(create).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("guardianship-relationship-1")).toBeInTheDocument();
  });

  it("given a fresh proof, when the retried write is refused for another reason, then the open form says why", async () => {
    // given
    vi.spyOn(api, "guardianRelationships").mockResolvedValue([]);
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [john], matching: 1 });
    vi.spyOn(api, "createGuardianRelationship")
      .mockRejectedValueOnce(refused("recent-authentication-required", 403))
      .mockRejectedValueOnce(refused("guardian-relationship-overlap", 409, "guardianship.overlaps"));
    const stepUp = show();
    await screen.findByTestId("guardianships-none");
    await chooseJohnAsDependant();
    await userEvent.click(screen.getByTestId("save-guardianship"));
    const retry = stepUp.mock.calls[0][0] as () => Promise<void>;

    // when
    await retry();

    // then
    expect(within(await screen.findByRole("dialog")).getByRole("alert"))
      .toHaveTextContent("This guardian already holds a relationship to this dependant on these days.");
  });

  it("given a running relationship, when the board changes it, then the chosen actions and a cleared end go to that relationship", async () => {
    // given
    vi.spyOn(api, "guardianRelationships").mockResolvedValue([{ ...actingForJohn, endedOn: "2030-01-01" }]);
    const change = vi.spyOn(api, "changeGuardianRelationship").mockResolvedValue(actingForJohn);
    show();

    // when
    await userEvent.click(await screen.findByTestId("change-guardianship-relationship-1"));
    expect(screen.queryByTestId("guardianship-search"), "the pair of a relationship is not changed").toBeNull();
    await userEvent.click(screen.getByTestId("guardianship-grant-BOOK"));
    await userEvent.click(screen.getByTestId("guardianship-grant-CANCEL_BOOKINGS"));
    await userEvent.clear(screen.getByTestId("guardianship-ended-on"));
    await userEvent.click(screen.getByTestId("save-guardianship"));

    // then
    expect(change).toHaveBeenCalledWith("person-1", "relationship-1", { grants: ["VIEW_BOOKINGS", "CANCEL_BOOKINGS"], endedOn: null });
  });

  it("given no action chosen, when the form is read, then it cannot be saved", async () => {
    // given
    vi.spyOn(api, "guardianRelationships").mockResolvedValue([actingForJohn]);
    show();

    // when
    await userEvent.click(await screen.findByTestId("change-guardianship-relationship-1"));
    await userEvent.click(screen.getByTestId("guardianship-grant-BOOK"));
    await userEvent.click(screen.getByTestId("guardianship-grant-VIEW_BOOKINGS"));

    // then
    expect(screen.getByTestId("save-guardianship")).toBeDisabled();
  });

  it("given a running relationship, when ending it today is confirmed, then that relationship is ended", async () => {
    // given
    vi.spyOn(api, "guardianRelationships").mockResolvedValue([actingForJohn]);
    const end = vi.spyOn(api, "endGuardianRelationship").mockResolvedValue({ ...actingForJohn, state: "ENDED" });
    show();

    // when
    await userEvent.click(await screen.findByTestId("end-guardianship-relationship-1"));
    expect(screen.getByRole("dialog")).toHaveTextContent("From today Jane Doe may do nothing more for John Roe.");
    await userEvent.click(screen.getByTestId("confirm-end-guardianship"));

    // then
    expect(end).toHaveBeenCalledWith("person-1", "relationship-1");
    expect(await screen.findByTestId("guardianship-success")).toHaveTextContent("The guardianship was ended.");
  });

  it("given a relationship recorded by mistake, when its removal is confirmed, then it is removed, and a cancelled removal removes nothing", async () => {
    // given
    vi.spyOn(api, "guardianRelationships").mockResolvedValue([actingForJohn]);
    const remove = vi.spyOn(api, "removeGuardianRelationship").mockResolvedValue();
    show();

    // when
    await userEvent.click(await screen.findByTestId("remove-guardianship-relationship-1"));
    await userEvent.click(screen.getByTestId("cancel-remove-guardianship"));
    await userEvent.click(screen.getByTestId("remove-guardianship-relationship-1"));
    await userEvent.click(screen.getByTestId("confirm-remove-guardianship"));

    // then
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("person-1", "relationship-1");
  });
});


it("given closed and open calendar ranges, when the language changes, then the displayed dates follow the locale", async () => {
  // given
  vi.spyOn(api, "guardianRelationships").mockResolvedValue([actingForJohn, actedForByMary]);
  await i18n.changeLanguage("en");
  show();
  const entry = await screen.findByTestId("guardianship-relationship-2");
  expect(entry).toHaveTextContent("Jan 1, 2025");
  expect(entry).toHaveTextContent("Jun 1, 2025");

  // when
  await act(() => i18n.changeLanguage("de"));

  // then
  expect(entry).toHaveTextContent("01.01.2025");
  expect(entry).toHaveTextContent("01.06.2025");
  expect(screen.getByTestId("guardianship-relationship-1")).toHaveTextContent("01.10.2026");
});
