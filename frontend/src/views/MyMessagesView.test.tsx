import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, type MessageChoice } from "../api/client";
import i18n from "../i18n";
import { MyMessagesView } from "./MyMessagesView";

const choices: MessageChoice[] = [
  { kind: "CREDENTIALS_NEW_ACCOUNT", declinable: false, enabled: true },
  { kind: "BOOKING_CONFIRMED", declinable: true, enabled: true },
  { kind: "BOOKING_PLAYER_RECORDED", declinable: false, enabled: true },
  { kind: "BOOKING_REMINDER", declinable: true, enabled: false }
];

describe("MyMessagesView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "ownMessageChoices").mockResolvedValue(choices);
  });

  it("given a kind the club must send, when the choices are shown, then it is on and cannot be switched off", async () => {
    // when
    render(<MyMessagesView />);

    // then
    const mandatory = await screen.findByTestId("message-choice-CREDENTIALS_NEW_ACCOUNT");
    expect(mandatory).toBeChecked();
    expect(mandatory).toBeDisabled();
    expect(screen.getByTestId("message-choice-BOOKING_CONFIRMED")).toBeEnabled();
  });

  it("given a kind already switched off, when the choices are shown, then it is unchecked", async () => {
    // when
    render(<MyMessagesView />);

    // then
    expect(await screen.findByTestId("message-choice-BOOKING_REMINDER")).not.toBeChecked();
  });

  it("given a kind is unchecked, when the choice is saved, then exactly the unwanted kinds are declined", async () => {
    // given
    const chosen = vi.spyOn(api, "chooseOwnMessages").mockResolvedValue(undefined);
    render(<MyMessagesView />);
    await screen.findByTestId("message-choice-BOOKING_CONFIRMED");

    // when
    await userEvent.click(screen.getByTestId("message-choice-BOOKING_CONFIRMED"));
    await userEvent.click(screen.getByTestId("my-messages-save"));

    // then
    expect(chosen).toHaveBeenCalledWith(["BOOKING_CONFIRMED", "BOOKING_REMINDER"]);
    expect(await screen.findByTestId("my-messages-saved")).toHaveTextContent("Your choice was saved.");
  });

  it("given every kind is wanted again, when the choice is saved, then nothing is declined", async () => {
    // given
    const chosen = vi.spyOn(api, "chooseOwnMessages").mockResolvedValue(undefined);
    render(<MyMessagesView />);
    await screen.findByTestId("message-choice-BOOKING_REMINDER");

    // when
    await userEvent.click(screen.getByTestId("message-choice-BOOKING_REMINDER"));
    await userEvent.click(screen.getByTestId("my-messages-save"));

    // then
    expect(chosen).toHaveBeenCalledWith([]);
  });

  it("given a tick nobody saved yet, when the language changes, then it is still ticked", async () => {
    // given
    render(<MyMessagesView />);
    await screen.findByTestId("message-choice-BOOKING_CONFIRMED");
    await userEvent.click(screen.getByTestId("message-choice-BOOKING_CONFIRMED"));

    // when
    await act(() => i18n.changeLanguage("de"));

    // then
    expect(screen.getByTestId("message-choice-BOOKING_CONFIRMED")).not.toBeChecked();
    expect(screen.getByTestId("message-choice-BOOKING_REMINDER")).not.toBeChecked();
  });

  it("given the instance refuses the choice, when it is saved, then the refusal is shown and nothing claims success", async () => {
    // given
    vi.spyOn(api, "chooseOwnMessages").mockRejectedValue(new ApiError(409, {
      type: "urn:courtside:error:message-not-declinable",
      title: "Not declinable",
      status: 409,
      violations: [{ code: "notification.message.notDeclinable", params: { kind: "BOOKING_DISPLACED" } }]
    }));
    render(<MyMessagesView />);
    await screen.findByTestId("message-choice-BOOKING_CONFIRMED");

    // when
    await userEvent.click(screen.getByTestId("message-choice-BOOKING_CONFIRMED"));
    await userEvent.click(screen.getByTestId("my-messages-save"));

    // then
    await waitFor(() => expect(screen.getByRole("alert"))
      .toHaveTextContent("This message cannot be switched off."));
    expect(screen.queryByTestId("my-messages-saved")).toBeNull();
  });
});
