import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ExternalReference, type RosterEntry } from "../../api/client";
import i18n from "../../i18n";
import { UnsavedCount } from "../../test/UnsavedCount";
import { UnsavedChangesProvider } from "../../unsaved/UnsavedChangesProvider";
import { ExternalReferencePanel } from "./ExternalReferencePanel";

const jane: RosterEntry = {
  personId: "person-1", firstName: "Jane", lastName: "Doe", email: "jane.doe@example.org",
  accountId: null, username: null, enabled: false, roles: []
};

const mary: RosterEntry = {
  personId: "person-2", firstName: "Mary", lastName: "Major", email: "mary.major@example.org",
  accountId: null, username: null, enabled: false, roles: []
};

const linked: ExternalReference = {
  referenceId: "ref-1", sourceId: "source-1", externalId: "4711",
  personId: "person-1", personName: "Jane Doe", linkedAt: "2026-08-21T10:00:00Z"
};

function show(reportError = vi.fn()) {
  render(<UnsavedChangesProvider>
    <UnsavedCount />
    <ExternalReferencePanel sourceId="source-1" disabled={false} reportError={reportError} />
  </UnsavedChangesProvider>);
}

describe("ExternalReferencePanel", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given linked records, when the panel opens, then each is named by member number and person", async () => {
    // given
    vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [linked], nextCursor: null });

    // when
    show();

    // then
    const row = await screen.findByTestId("reference-4711");
    expect(row).toHaveTextContent("4711");
    expect(row).toHaveTextContent("Jane Doe");
  });

  it("given no record is linked yet, when the panel opens, then it says so", async () => {
    // given
    vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [], nextCursor: null });

    // when
    show();

    // then
    expect(await screen.findByTestId("no-references")).toHaveTextContent(
      "Members linked to external identifiers appear here. Run an import or link a person below."
    );
  });

  it("given a burst of eligible search input, when the board pauses, then only the final query is asked", async () => {
    // given
    vi.useFakeTimers();
    vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [], nextCursor: null });
    const searching = vi.spyOn(api, "roster").mockResolvedValue({ entries: [jane], nextCursor: null });
    show();

    // when
    const field = screen.getByTestId("reference-person-search");
    fireEvent.change(field, { target: { value: "D" } });
    fireEvent.change(field, { target: { value: "Do" } });
    fireEvent.change(field, { target: { value: "Doe" } });

    // then
    expect(searching).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Searching for people");
    await act(() => vi.advanceTimersByTimeAsync(249));
    expect(searching).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(searching).toHaveBeenCalledTimes(1);
    expect(searching).toHaveBeenCalledWith("Doe", undefined, 10);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("given fewer than two characters, when the board pauses, then no broad roster search starts", async () => {
    // given
    vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [], nextCursor: null });
    const searching = vi.spyOn(api, "roster").mockResolvedValue({ entries: [jane], nextCursor: null });
    show();
    await screen.findByTestId("no-references");

    // when
    await userEvent.type(screen.getByTestId("reference-person-search"), "D");

    // then
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    expect(searching).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("given visible matches, when the query changes, then stale people disappear while the new answer is pending", async () => {
    // given
    vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [], nextCursor: null });
    vi.spyOn(api, "roster")
      .mockResolvedValueOnce({ entries: [jane], nextCursor: null })
      .mockReturnValueOnce(new Promise(() => undefined));
    show();
    await screen.findByTestId("no-references");
    await userEvent.type(screen.getByTestId("reference-person-search"), "Doe");
    expect(await screen.findByTestId("reference-person-person-1")).toBeInTheDocument();

    // when
    await userEvent.clear(screen.getByTestId("reference-person-search"));
    await userEvent.type(screen.getByTestId("reference-person-search"), "Major");

    // then
    expect(screen.queryByTestId("reference-person-person-1")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Searching for people");
  });

  it("given a person the file already knows, when they are linked by hand, then the link is written", async () => {
    // given
    vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [], nextCursor: null });
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [jane], nextCursor: null });
    const linking = vi.spyOn(api, "linkExternalReference").mockResolvedValue(linked);
    show();
    await screen.findByTestId("no-references");

    // when
    await userEvent.type(screen.getByTestId("reference-person-search"), "Doe");
    await userEvent.click(await screen.findByTestId("reference-person-person-1"));
    await userEvent.type(screen.getByTestId("reference-external-id"), "4711");
    await userEvent.click(screen.getByTestId("link-reference"));

    // then
    expect(linking).toHaveBeenCalledWith("source-1", { externalId: "4711", personId: "person-1" });
    expect(await screen.findByTestId("reference-4711")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Reference linked.");
  });

  it("given a search still in flight, when the field is emptied, then its answer cannot fill the list back in", async () => {
    // given
    vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [], nextCursor: null });
    let answer!: (page: { entries: RosterEntry[]; nextCursor: null }) => void;
    const asked = new Promise<{ entries: RosterEntry[]; nextCursor: null }>((resolve) => {
      answer = resolve;
    });
    vi.spyOn(api, "roster").mockReturnValue(asked);
    show();
    await screen.findByTestId("no-references");
    await userEvent.type(screen.getByTestId("reference-person-search"), "Doe");
    await waitFor(() => expect(api.roster).toHaveBeenCalledTimes(1));

    // when — the board deletes the query, then the answer to it arrives
    await userEvent.clear(screen.getByTestId("reference-person-search"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await act(async () => {
      answer({ entries: [jane], nextCursor: null });
      await asked;
    });

    // then
    expect(screen.getByTestId("reference-person-search")).toHaveValue("");
    expect(screen.queryByTestId("reference-person-person-1")).not.toBeInTheDocument();
  });

  it("given a query the board has replaced, when the earlier answer arrives last, then the newer one stands", async () => {
    // given
    vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [], nextCursor: null });
    const answers: ((page: { entries: RosterEntry[]; nextCursor: null }) => void)[] = [];
    const asked: Promise<{ entries: RosterEntry[]; nextCursor: null }>[] = [];
    vi.spyOn(api, "roster").mockImplementation(() => {
      const answer = new Promise<{ entries: RosterEntry[]; nextCursor: null }>((resolve) => {
        answers.push(resolve);
      });
      asked.push(answer);
      return answer;
    });
    show();
    await screen.findByTestId("no-references");
    await userEvent.type(screen.getByTestId("reference-person-search"), "Doe");
    await waitFor(() => expect(api.roster).toHaveBeenCalledTimes(1));
    await userEvent.clear(screen.getByTestId("reference-person-search"));
    await userEvent.type(screen.getByTestId("reference-person-search"), "Major");
    await waitFor(() => expect(api.roster).toHaveBeenCalledTimes(2));

    // when — the replaced query answers after the one that replaced it
    await act(async () => {
      answers[answers.length - 1]({ entries: [mary], nextCursor: null });
      await asked[asked.length - 1];
    });
    expect(await screen.findByTestId("reference-person-person-2")).toBeInTheDocument();
    await act(async () => {
      answers[0]({ entries: [jane], nextCursor: null });
      await asked[0];
    });

    // then
    expect(screen.queryByTestId("reference-person-person-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("reference-person-person-2")).toBeInTheDocument();
  });

  it("given a search that fails, when it is the query on screen, then the failure is reported", async () => {
    // given
    vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [], nextCursor: null });
    let refuse!: (failure: Error) => void;
    const asked = new Promise<never>((_resolve, reject) => { refuse = reject; });
    vi.spyOn(api, "roster").mockReturnValue(asked);
    const reportError = vi.fn();
    show(reportError);
    await screen.findByTestId("no-references");
    await userEvent.type(screen.getByTestId("reference-person-search"), "Doe");
    await waitFor(() => expect(api.roster).toHaveBeenCalledTimes(1));

    // when
    await act(async () => {
      refuse(new Error("unavailable"));
      await asked.catch(() => undefined);
    });

    // then
    expect(reportError).toHaveBeenCalled();
  });

  it("given a search that fails, when the board has already replaced the query, then the failure is not reported", async () => {
    // given
    vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [], nextCursor: null });
    let refuse!: (failure: Error) => void;
    const asked = new Promise<never>((_resolve, reject) => { refuse = reject; });
    vi.spyOn(api, "roster").mockReturnValue(asked);
    const reportError = vi.fn();
    show(reportError);
    await screen.findByTestId("no-references");
    await userEvent.type(screen.getByTestId("reference-person-search"), "Doe");
    await waitFor(() => expect(api.roster).toHaveBeenCalledTimes(1));

    // when
    await userEvent.clear(screen.getByTestId("reference-person-search"));
    await act(async () => {
      refuse(new Error("unavailable"));
      await asked.catch(() => undefined);
    });

    // then
    expect(reportError).not.toHaveBeenCalled();
  });

  it("given a link that was a mistake, when it is undone, then no dialog stands in the way", async () => {
    // given
    vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [linked], nextCursor: null });
    const unlinking = vi.spyOn(api, "unlinkExternalReference").mockResolvedValue(undefined);
    show();

    // when — linking again restores it, so by this project's rule no confirmation belongs here
    await userEvent.click(await screen.findByTestId("unlink-4711"));

    // then
    expect(unlinking).toHaveBeenCalledWith("source-1", "4711");
    expect(screen.queryByTestId("reference-4711")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Reference unlinked.");
  });

  it("given more references than one page holds, when the rest is asked for, then the cursor is passed on", async () => {
    // given
    const second: ExternalReference = { ...linked, referenceId: "ref-2", externalId: "4712", personName: "John Roe" };
    const reading = vi.spyOn(api, "externalReferences")
      .mockResolvedValueOnce({ references: [linked], nextCursor: "ref-1" })
      .mockResolvedValueOnce({ references: [second], nextCursor: null });
    show();
    await screen.findByTestId("reference-4711");

    // when
    await userEvent.click(screen.getByTestId("more-references"));

    // then
    expect(reading).toHaveBeenLastCalledWith("source-1", "ref-1");
    expect(await screen.findByTestId("reference-4712")).toBeInTheDocument();
    expect(screen.getByTestId("reference-4711")).toBeInTheDocument();
  });

  it("given the references cannot be read, when the panel opens, then the failure is reported upward", async () => {
    // given
    const reportError = vi.fn();
    vi.spyOn(api, "externalReferences").mockRejectedValue(new Error("unavailable"));

    // when
    show(reportError);

    // then
    await vi.waitFor(() => expect(reportError).toHaveBeenCalled());
  });
});

it("given a member number typed for a link, when it is cleared again, then nothing is left to lose", async () => {
  // given
  vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [], nextCursor: null });
  show();
  const number = await screen.findByTestId("reference-external-id");
  expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0");

  // when
  await userEvent.type(number, "4711");

  // then
  await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));

  // when
  await userEvent.clear(number);

  // then
  await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
});
