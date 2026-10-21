import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
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

  it("given recovery reached with a target, when the member goes back to sign in, then the target travels with them", () => {
    // when
    render(<MemoryRouter initialEntries={["/account-recovery?returnTo=%2Fmy-bookings"]}><AccountRecoveryView /></MemoryRouter>);

    // then
    expect(screen.getByTestId("recovery-back-to-login"), "returning to sign-in keeps the page the member opened")
      .toHaveAttribute("href", "/login?returnTo=%2Fmy-bookings");
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

  it("given the username reminder, when it answers, then its confirmation follows its own button", async () => {
    // given
    vi.spyOn(api, "requestUsernameReminder").mockResolvedValue(undefined);
    const scrolled = vi.fn();
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scrolled });
    onTestFinished(() => {
      if (original) Object.defineProperty(Element.prototype, "scrollIntoView", original);
      else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    });
    show();

    // when
    await userEvent.type(screen.getByTestId("recovery-email"), "roe@example.org");
    await userEvent.click(screen.getByTestId("recovery-usernames-submit"));

    // then
    const sent = await screen.findByTestId("recovery-sent");
    expect(screen.getByTestId("recovery-usernames-submit").compareDocumentPosition(sent)
      & Node.DOCUMENT_POSITION_FOLLOWING, "the answer sits where the member pressed the button").toBeTruthy();
    expect(screen.getByTestId("recovery-usernames-submit").closest("form"), "the answer belongs to the form that was sent")
      .toContainElement(sent);
    expect(scrolled, "the answer is brought into view").toHaveBeenCalledWith({ block: "nearest" });
  });

  it("given a code that is refused, when the redemption answers, then the refusal sits in the redemption form", async () => {
    // given
    vi.spyOn(api, "redeemPasswordReset").mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:password-reset-code-invalid", title: "Invalid code", status: 400 }));
    show();

    // when
    await userEvent.type(screen.getByTestId("recovery-code"), "ABCD-EFGH");
    await userEvent.type(screen.getByTestId("recovery-new-password"), "the-one-they-picked-alone");
    await userEvent.click(screen.getByTestId("recovery-redeem-submit"));

    // then
    expect(screen.getByTestId("recovery-redeem-submit").closest("form"), "the refusal belongs to the form that was sent")
      .toContainElement(await screen.findByRole("alert"));
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
