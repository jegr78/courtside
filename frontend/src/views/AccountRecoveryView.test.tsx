import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api/client";
import i18n from "../i18n";
import { AccountRecoveryView } from "./AccountRecoveryView";

function show() {
  render(<MemoryRouter><AccountRecoveryView /></MemoryRouter>);
}

describe("AccountRecoveryView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given a member who forgot their password, when they name themselves, then a new one is asked for", async () => {
    // given
    const asked = vi.spyOn(api, "requestPasswordReset").mockResolvedValue(undefined);
    show();

    // when
    await userEvent.type(screen.getByTestId("recovery-username"), "doe.jane");
    await userEvent.click(screen.getByTestId("recovery-password-submit"));

    // then
    expect(asked).toHaveBeenCalledWith("doe.jane");
    expect(await screen.findByTestId("recovery-sent"))
      .toHaveTextContent("If that username belongs to an account, a message is on its way.");
  });

  it("given a name no account holds, when it is submitted, then the page says the same thing", async () => {
    // given
    vi.spyOn(api, "requestPasswordReset").mockResolvedValue(undefined);
    show();

    // when
    await userEvent.type(screen.getByTestId("recovery-username"), "nobody.here");
    await userEvent.click(screen.getByTestId("recovery-password-submit"));

    // then
    expect(await screen.findByTestId("recovery-sent"))
      .toHaveTextContent("If that username belongs to an account, a message is on its way.");
  });

  it("given a member who forgot their username, when they give their address, then no password is asked for", async () => {
    // given
    const reminded = vi.spyOn(api, "requestUsernameReminder").mockResolvedValue(undefined);
    const reset = vi.spyOn(api, "requestPasswordReset").mockResolvedValue(undefined);
    show();

    // when
    await userEvent.type(screen.getByTestId("recovery-email"), "roe@example.org");
    await userEvent.click(screen.getByTestId("recovery-usernames-submit"));

    // then
    expect(reminded).toHaveBeenCalledWith("roe@example.org");
    expect(reset).not.toHaveBeenCalled();
    expect(await screen.findByTestId("recovery-sent"))
      .toHaveTextContent("If any accounts belong to that address, a message is on its way.");
  });

  it("given a request that was sent, when the next one is refused, then the page no longer says it was sent", async () => {
    // given
    vi.spyOn(api, "requestPasswordReset").mockResolvedValue(undefined);
    vi.spyOn(api, "requestUsernameReminder").mockRejectedValue(new ApiError(429, {
      type: "urn:courtside:error:account-recovery-rate-limited",
      title: "Too many recovery requests",
      status: 429,
      violations: [{ code: "identity.recovery.rateLimited", params: {} }]
    }));
    show();
    await userEvent.type(screen.getByTestId("recovery-username"), "doe.jane");
    await userEvent.click(screen.getByTestId("recovery-password-submit"));
    expect(await screen.findByTestId("recovery-sent")).toBeInTheDocument();

    // when
    await userEvent.type(screen.getByTestId("recovery-email"), "roe@example.org");
    await userEvent.click(screen.getByTestId("recovery-usernames-submit"));

    // then
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("That has been asked too often. Try again later.");
    expect(screen.queryByTestId("recovery-sent")).not.toBeInTheDocument();
  });

  it("given somebody who has asked too often, when they ask again, then the refusal is shown", async () => {
    // given
    vi.spyOn(api, "requestPasswordReset").mockRejectedValue(new ApiError(429, {
      type: "urn:courtside:error:account-recovery-rate-limited",
      title: "Too many recovery requests",
      status: 429,
      violations: [{ code: "identity.recovery.rateLimited", params: {} }]
    }));
    show();

    // when
    await userEvent.type(screen.getByTestId("recovery-username"), "doe.jane");
    await userEvent.click(screen.getByTestId("recovery-password-submit"));

    // then
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("That has been asked too often. Try again later.");
    expect(screen.queryByTestId("recovery-sent")).not.toBeInTheDocument();
  });
});
