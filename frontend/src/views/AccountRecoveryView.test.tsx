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

  it("given a code and a new password, when they are redeemed, then the page says the password is set", async () => {
    // given
    const redeemed = vi.spyOn(api, "redeemPasswordReset").mockResolvedValue(undefined);
    show();

    // when
    await userEvent.type(screen.getByTestId("recovery-code"), "  ABCD-EFGH ");
    await userEvent.type(screen.getByTestId("recovery-new-password"), "clay-court-evening");
    await userEvent.click(screen.getByTestId("recovery-redeem-submit"));

    // then — the contract pattern is anchored, so a code pasted with its surrounding blanks would
    // be refused as a malformed request rather than compared
    expect(redeemed).toHaveBeenCalledWith("ABCD-EFGH", "clay-court-evening");
    expect(await screen.findByTestId("recovery-sent"))
      .toHaveTextContent("The password is set. You can sign in with it now.");
  });

  it("given a code the instance refuses, when it is redeemed, then the refusal names the code and not the password", async () => {
    // given
    vi.spyOn(api, "redeemPasswordReset").mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:account-recovery-code-expired",
      title: "The code has expired",
      status: 400,
      violations: [{ code: "identity.recovery.codeExpired", params: {} }]
    }));
    show();

    // when
    await userEvent.type(screen.getByTestId("recovery-code"), "ABCD-EFGH");
    await userEvent.type(screen.getByTestId("recovery-new-password"), "clay-court-evening");
    await userEvent.click(screen.getByTestId("recovery-redeem-submit"));

    // then
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("That code has expired. Ask for a new one above.");
    expect(screen.queryByTestId("recovery-sent")).not.toBeInTheDocument();
  });

  it("given a password the rules reject, when the same code is redeemed again, then the second attempt reaches the instance", async () => {
    // given
    const redeemed = vi.spyOn(api, "redeemPasswordReset")
      .mockRejectedValueOnce(new ApiError(400, {
        type: "urn:courtside:error:password-too-guessable",
        title: "The password is too guessable",
        status: 400,
        violations: [{ code: "identity.password.tooGuessable", params: {} }]
      }))
      .mockResolvedValue(undefined);
    show();
    await userEvent.type(screen.getByTestId("recovery-code"), "ABCD-EFGH");
    await userEvent.type(screen.getByTestId("recovery-new-password"), "password1234");
    await userEvent.click(screen.getByTestId("recovery-redeem-submit"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    // when
    await userEvent.clear(screen.getByTestId("recovery-new-password"));
    await userEvent.type(screen.getByTestId("recovery-new-password"), "clay-court-evening");
    await userEvent.click(screen.getByTestId("recovery-redeem-submit"));

    // then
    expect(redeemed).toHaveBeenNthCalledWith(2, "ABCD-EFGH", "clay-court-evening");
    expect(await screen.findByTestId("recovery-sent"))
      .toHaveTextContent("The password is set. You can sign in with it now.");
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
