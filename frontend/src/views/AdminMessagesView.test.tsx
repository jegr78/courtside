import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api, type ClubConfig, type MessageEntry } from "../api/client";
import i18n from "../i18n";
import { WithClubConfiguration } from "../test/ClubConfiguration";
import { AdminMessagesView } from "./AdminMessagesView";

const handedOver: MessageEntry = {
  id: "11111111-1111-1111-1111-111111111111",
  queuedAt: "2026-08-20T12:00:00Z",
  settledAt: "2026-08-20T12:00:01Z",
  kind: "CREDENTIALS_NEW_ACCOUNT",
  state: "HANDED_OVER",
  messageId: "<a-message-id@example.org>",
  reason: null,
  statusCode: null,
  personId: "22222222-2222-2222-2222-222222222222",
  personName: "Jane Doe"
};

const refused: MessageEntry = {
  ...handedOver,
  id: "33333333-3333-3333-3333-333333333333",
  state: "REFUSED",
  messageId: "<another-message-id@example.org>",
  reason: "SendFailedException",
  statusCode: "550",
  personId: "44444444-4444-4444-4444-444444444444",
  personName: "John Roe"
};

const clubConfig: ClubConfig = {
  clubName: "Example Tennis Club", primaryColor: "#000000", accentColor: "#ffffff",
  logoUrl: null, imprintUrl: null, defaultLocale: "en", supportedLocales: ["de", "en"],
  slotMinutes: 60, timeZone: "Europe/Berlin"
};

function show() {
  render(<MemoryRouter><WithClubConfiguration club={clubConfig}><AdminMessagesView /></WithClubConfiguration></MemoryRouter>);
}

function row(entryId: string): HTMLElement {
  const found = screen.getAllByTestId("message-row")
    .find((element) => element.getAttribute("data-entry-id") === entryId);
  if (!found) throw new Error(`No message row rendered for entry ${entryId}`);
  return found;
}

describe("AdminMessagesView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given a handed-over message, when the log is shown, then the row rests there and claims no delivery", async () => {
    // given
    vi.spyOn(api, "messages").mockResolvedValue({ entries: [handedOver], nextCursor: null });

    // when
    show();
    await screen.findByTestId("message-row");

    // then
    const entryRow = row(handedOver.id);
    expect(entryRow).toHaveAttribute("data-state", "HANDED_OVER");
    expect(within(entryRow).getByTestId("message-state")).toHaveTextContent("Handed over");
    expect(within(entryRow).getByTestId("message-kind"))
      .toHaveTextContent("Credentials for a new account");
    expect(within(entryRow).getByTestId("message-id")).toHaveTextContent("<a-message-id@example.org>");
    expect(screen.getByTestId("messages-handover-note")).toHaveTextContent(
      /passed the message to the club’s mail server.*cannot know/s);
  });

  it.each(["en", "de"])("given the state labels in %s, when they are read, then none of them claims delivery",
async (language) => {
    // given — the one claim this instance is in no position to make
    await i18n.changeLanguage(language);

    // when
    const labels = (["QUEUED", "HANDED_OVER", "REFUSED", "FAILED"] as const)
      .map((state) => i18n.t(`messages.state.${state}`));

    // then
    expect(labels).toHaveLength(4);
    labels.forEach((label) => expect(label).not.toMatch(/deliver|zugestellt|zustellung/i));
  });

  it("given a refused message, when the log is shown, then the row carries what the relay answered", async () => {
    // given
    vi.spyOn(api, "messages").mockResolvedValue({ entries: [refused], nextCursor: null });

    // when
    show();
    await screen.findByTestId("message-row");

    // then
    const entryRow = row(refused.id);
    expect(within(entryRow).getByTestId("message-outcome"))
      .toHaveTextContent("SendFailedException (550)");
  });

  it("given a refused message, when the log is shown, then the row points at the person to correct", async () => {
    // given
    vi.spyOn(api, "messages").mockResolvedValue({ entries: [refused], nextCursor: null });

    // when
    show();
    await screen.findByTestId("message-row");

    // then
    expect(within(row(refused.id)).getByTestId("message-person-link"))
      .toHaveAttribute("href", `/admin/roster/${refused.personId}`);
    expect(screen.getByTestId("messages-refused-hint")).toHaveTextContent(/correct the address/i);
  });

  it("given a refusal on the page, when it is read, then nothing on it offers to send the message again", async () => {
    // given — a credential exists only as a hash once it has gone out, so a resend cannot work
    vi.spyOn(api, "messages").mockResolvedValue({ entries: [refused], nextCursor: null });

    // when
    show();
    await screen.findByTestId("message-row");

    // then — every control on the page navigates, and the only places it goes are readable pages
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link").map((link) => link.getAttribute("href")))
      .toEqual([`/admin/roster/${refused.personId}`]);
  });

  it("given only what went wrong is asked, when the filter is set, then the log is read again for it", async () => {
    // given
    const messages = vi.spyOn(api, "messages")
      .mockResolvedValue({ entries: [handedOver], nextCursor: null });
    show();
    await screen.findByTestId("message-row");
    messages.mockResolvedValue({ entries: [refused], nextCursor: null });

    // when
    await userEvent.click(screen.getByTestId("messages-unsettled-filter"));

    // then
    await waitFor(() => expect(row(refused.id)).toBeInTheDocument());
    expect(messages).toHaveBeenLastCalledWith(undefined, 50, { unsettled: true });
    expect(screen.queryByTestId("message-row")).toHaveAttribute("data-state", "REFUSED");
  });

  it("given a further page, when more is asked for, then it is appended behind the cursor", async () => {
    // given
    const messages = vi.spyOn(api, "messages")
      .mockResolvedValue({ entries: [handedOver], nextCursor: "a-cursor" });
    show();
    await screen.findByTestId("message-row");
    messages.mockResolvedValue({ entries: [refused], nextCursor: null });

    // when
    await userEvent.click(screen.getByTestId("messages-load-more"));

    // then
    await waitFor(() => expect(screen.getAllByTestId("message-row")).toHaveLength(2));
    expect(messages).toHaveBeenLastCalledWith("a-cursor", 50, { unsettled: false });
  });

  it("given nothing has been sent, when the log is shown, then it says so instead of rendering an empty table", async () => {
    // given
    vi.spyOn(api, "messages").mockResolvedValue({ entries: [], nextCursor: null });

    // when
    show();

    // then
    expect(await screen.findByTestId("messages-empty")).toHaveTextContent(
      "Messages sent by Courtside appear here. Create or change a booking to trigger the first notification."
    );
    expect(screen.queryByTestId("message-row")).not.toBeInTheDocument();
  });

  it("given no message needs attention, when filtering unsettled messages, then the empty state names how to see the log", async () => {
    // given
    vi.spyOn(api, "messages").mockResolvedValue({ entries: [], nextCursor: null });
    show();
    await screen.findByTestId("messages-empty");

    // when
    await userEvent.click(screen.getByTestId("messages-unsettled-filter"));

    // then
    expect(await screen.findByTestId("messages-empty")).toHaveTextContent(
      "Rejected or failed messages appear here. Clear the filter to view all messages."
    );
  });
});
