import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type AccountSession } from "../api/client";
import i18n from "../i18n";
import { AccountSecurityView } from "./AccountSecurityView";

const current: AccountSession = {
  handle: "A234567890123456789012",
  createdAt: "2026-09-07T10:00:00Z",
  lastActivityAt: "2026-09-07T11:00:00Z",
  current: true,
  browserFamily: "FIREFOX"
};
const other: AccountSession = {
  ...current,
  handle: "B234567890123456789012",
  current: false,
  browserFamily: "EDGE"
};

function input(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`Input ${id} is missing`);
  return element;
}

async function renderedSecurityView() {
  const view = screen.getByTestId("account-security-view");
  await waitFor(() => expect(view).toHaveTextContent("Firefox"));
  return view;
}

describe("AccountSecurityView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "accountSessions").mockResolvedValue([current, other]);
  });

  it("shows only normalized session metadata and identifies this browser", async () => {
    // given / when
    render(<AccountSecurityView passwordChanged={vi.fn()} signedOut={vi.fn()} />);

    // then
    const view = await renderedSecurityView();
    expect(view).toHaveTextContent("this browser");
    expect(view).toHaveTextContent("Edge");
    expect(view).not.toHaveTextContent(/user-agent|ip address/i);
  });

  it("shows a session-loading failure in the security view", async () => {
    // given
    vi.mocked(api.accountSessions).mockRejectedValue(new Error("unavailable"));

    // when
    render(<AccountSecurityView passwordChanged={vi.fn()} signedOut={vi.fn()} />);

    // then
    expect(await screen.findByTestId("account-security-failure")).toBeInTheDocument();
  });

  it("proves the password and retries the exact session revocation when recent authentication expired", async () => {
    // given
    const end = vi.spyOn(api, "endAccountSession")
      .mockRejectedValueOnce(new ApiError(403, {
        type: "urn:courtside:error:recent-authentication-required",
        title: "Recent authentication required", status: 403
      }))
      .mockResolvedValue(undefined);
    const prove = vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
    render(<AccountSecurityView passwordChanged={vi.fn()} signedOut={vi.fn()} />);
    await renderedSecurityView();

    // when
    await userEvent.click(screen.getByTestId("end-other-session"));
    const dialog = await screen.findByRole("dialog");
    const password = input("reauthentication-password");
    expect(dialog).toContainElement(password);
    expect(password).toHaveFocus();
    await userEvent.type(password, "correct-password");
    await userEvent.click(within(dialog).getByRole("button"));

    // then
    await waitFor(() => expect(end).toHaveBeenCalledTimes(2));
    expect(end).toHaveBeenNthCalledWith(2, other.handle);
    expect(prove).toHaveBeenCalledWith("correct-password");
  });

  it("reports rejected reauthentication inside the open dialog", async () => {
    // given
    vi.spyOn(api, "endAccountSession").mockRejectedValue(new ApiError(403, {
      type: "urn:courtside:error:recent-authentication-required",
      title: "Recent authentication required", status: 403
    }));
    vi.spyOn(api, "reauthenticate").mockRejectedValue(new ApiError(403, {
      type: "urn:courtside:error:reauthentication-failed",
      title: "Reauthentication failed", status: 403
    }));
    render(<AccountSecurityView passwordChanged={vi.fn()} signedOut={vi.fn()} />);
    await renderedSecurityView();
    await userEvent.click(screen.getByTestId("end-other-session"));
    const dialog = await screen.findByRole("dialog");

    // when
    await userEvent.type(input("reauthentication-password"), "wrong-password");
    await userEvent.click(within(dialog).getByRole("button"));

    // then
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("dismisses a requested reauthentication without running the pending action", async () => {
    // given
    const end = vi.spyOn(api, "endAccountSession").mockRejectedValue(new ApiError(403, {
      type: "urn:courtside:error:recent-authentication-required",
      title: "Recent authentication required", status: 403
    }));
    render(<AccountSecurityView passwordChanged={vi.fn()} signedOut={vi.fn()} />);
    await renderedSecurityView();
    await userEvent.click(screen.getByTestId("end-other-session"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // when
    await userEvent.keyboard("{Escape}");

    // then
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(end).toHaveBeenCalledOnce();
  });

  it("changes the password only after matching confirmation and reports the ended session", async () => {
    // given
    const change = vi.spyOn(api, "changeOwnPassword").mockResolvedValue(undefined);
    const passwordChanged = vi.fn();
    const signedOut = vi.fn();
    render(<AccountSecurityView passwordChanged={passwordChanged} signedOut={signedOut} />);
    await renderedSecurityView();

    // when
    await userEvent.type(input("current-password"), "current-secret");
    await userEvent.type(input("new-password"), "a-new-long-passphrase");
    await userEvent.type(input("confirm-password"), "a-new-long-passphrase");
    fireEvent.submit(input("current-password").form!);

    // then
    await waitFor(() => expect(change).toHaveBeenCalledWith("current-secret", "a-new-long-passphrase"));
    expect(passwordChanged).toHaveBeenCalledOnce();
    expect(signedOut).not.toHaveBeenCalled();
  });

  it("rejects a short or mismatching replacement before sending it", async () => {
    // given
    const change = vi.spyOn(api, "changeOwnPassword").mockResolvedValue(undefined);
    render(<AccountSecurityView passwordChanged={vi.fn()} signedOut={vi.fn()} />);
    await renderedSecurityView();
    const form = input("current-password").form;
    if (!form) throw new Error("The password form is missing");
    await userEvent.type(input("new-password"), "too-short");
    await userEvent.type(input("confirm-password"), "too-short");

    // when / then
    fireEvent.submit(form);
    expect(await screen.findByTestId("account-security-failure"))
      .toHaveTextContent("The password must contain at least 12 characters.");
    await userEvent.clear(input("new-password"));
    await userEvent.clear(input("confirm-password"));
    await userEvent.type(input("new-password"), "long-replacement");
    await userEvent.type(input("confirm-password"), "different-value");
    fireEvent.submit(form);
    expect(await screen.findByTestId("account-security-failure"))
      .toHaveTextContent("The passwords do not match.");
    expect(change).not.toHaveBeenCalled();
  });

  it("signs out without reporting a password change when this session is ended", async () => {
    // given
    vi.spyOn(api, "endAccountSession").mockResolvedValue(undefined);
    const passwordChanged = vi.fn();
    const signedOut = vi.fn();
    render(<AccountSecurityView passwordChanged={passwordChanged} signedOut={signedOut} />);
    await renderedSecurityView();

    // when
    await userEvent.click(screen.getByTestId("end-current-session"));

    // then
    await waitFor(() => expect(signedOut).toHaveBeenCalledOnce());
    expect(passwordChanged).not.toHaveBeenCalled();
  });

  it("signs out without reporting a password change when every session is ended", async () => {
    // given
    vi.spyOn(api, "endOwnSessions").mockResolvedValue(undefined);
    const passwordChanged = vi.fn();
    const signedOut = vi.fn();
    render(<AccountSecurityView passwordChanged={passwordChanged} signedOut={signedOut} />);
    await renderedSecurityView();

    // when
    await userEvent.click(screen.getByTestId("end-all-sessions"));

    // then
    await waitFor(() => expect(signedOut).toHaveBeenCalledOnce());
    expect(passwordChanged).not.toHaveBeenCalled();
  });
});
