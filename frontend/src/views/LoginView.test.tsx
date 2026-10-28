import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError, api } from "../api/client";
import i18n from "../i18n";
import { LoginView } from "./LoginView";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("LoginView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  afterEach(() => vi.useRealTimers());

  it("given a sign-in that carries a target, when the member opens the forgotten-credentials link, then the target travels with it", () => {
    // when
    render(<MemoryRouter initialEntries={["/login?returnTo=%2Fmy-bookings%23booking-42"]}><LoginView refreshSession={() => Promise.resolve()} /></MemoryRouter>);

    // then
    expect(screen.getByTestId("forgotten-credentials-link"), "recovering an account keeps the page the member opened")
      .toHaveAttribute("href", "/account-recovery?returnTo=%2Fmy-bookings%23booking-42");
  });

  it("given refused credentials, when signing in, then the member reads that the username or password is wrong", async () => {
    // given
    vi.spyOn(api, "login").mockRejectedValue(new ApiError(401, {
      type: "urn:courtside:error:unauthenticated", title: "Not authenticated", status: 401
    }));
    render(<MemoryRouter><LoginView refreshSession={() => Promise.resolve()} /></MemoryRouter>);

    // when
    await userEvent.type(screen.getByTestId("username"), "doe.jane");
    await userEvent.type(screen.getByTestId("password"), "wrong-password");
    await userEvent.click(screen.getByTestId("login-submit"));

    // then
    expect(await screen.findByRole("alert"), "a refused sign-in names the credentials, not an ended session")
      .toHaveTextContent("The username or password is incorrect.");
    expect(api.login).toHaveBeenCalledOnce();
  });

  it("given temporary admission pressure, when the member signs in, then show translated waiting feedback and keep credentials out of storage", async () => {
    // given
    const refusal = new ApiError(429, { type: "urn:courtside:error:login-rate-limited", title: "Busy", status: 429 }, 1);
    const login = vi.spyOn(api, "login").mockRejectedValueOnce(refusal).mockResolvedValueOnce(undefined);
    const persisted = vi.spyOn(Storage.prototype, "setItem");
    const refreshed = vi.fn().mockResolvedValue(undefined);
    render(<MemoryRouter><LoginView refreshSession={refreshed} /></MemoryRouter>);
    await userEvent.type(screen.getByTestId("username"), "doe.jane");
    await userEvent.type(screen.getByTestId("password"), "private-password");
    vi.useFakeTimers();
    // when
    fireEvent.click(screen.getByTestId("login-submit"));
    fireEvent.submit(screen.getByTestId("login-submit").closest("form")!);
    await act(() => vi.advanceTimersByTimeAsync(0));
    // then
    expect(screen.getByRole("status")).toHaveTextContent("Sign-in is busy. Retrying in 1 second");
    expect(screen.getByTestId("username")).toBeDisabled();
    expect(screen.getByTestId("password")).toBeDisabled();
    expect(screen.getByTestId("password")).toHaveValue("");
    expect(login).toHaveBeenCalledTimes(1);
    expect(refreshed).not.toHaveBeenCalled();
    expect(JSON.stringify(persisted.mock.calls)).not.toContain("private-password");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(login).toHaveBeenCalledTimes(2);
    expect(refreshed).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByTestId("login-submit")).toBeEnabled();
  });

  it("given a waiting sign-in, when the member leaves the page, then abort without retrying or refreshing the session", async () => {
    // given
    const login = vi.spyOn(api, "login").mockRejectedValue(new ApiError(429,
      { type: "urn:courtside:error:login-rate-limited", title: "Busy", status: 429 }, 1));
    const refreshed = vi.fn().mockResolvedValue(undefined);
    const view = render(<MemoryRouter><LoginView refreshSession={refreshed} /></MemoryRouter>);
    await userEvent.type(screen.getByTestId("username"), "doe.jane");
    await userEvent.type(screen.getByTestId("password"), "secret");
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId("login-submit"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    // when
    view.unmount();
    await act(() => vi.runAllTimersAsync());
    // then
    expect(login).toHaveBeenCalledTimes(1);
    expect(login.mock.calls[0][2]?.aborted).toBe(true);
    expect(refreshed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("given an unresponsive sign-in, when the total deadline expires, then show the translated timeout and allow a new attempt", async () => {
    // given
    vi.spyOn(api, "login").mockImplementation(() => new Promise(() => {}));
    const refreshed = vi.fn().mockResolvedValue(undefined);
    render(<MemoryRouter><LoginView refreshSession={refreshed} /></MemoryRouter>);
    await userEvent.type(screen.getByTestId("username"), "doe.jane");
    await userEvent.type(screen.getByTestId("password"), "secret");
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId("login-submit"));
    // when
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    // then
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in took too long. Please try again.");
    expect(screen.getByTestId("login-submit")).toBeEnabled();
    expect(screen.getByTestId("password")).toHaveValue("");
    expect(refreshed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("given German admission feedback, when requesting one or several seconds, then use the matching translated form", async () => {
    // given
    await i18n.changeLanguage("de");
    // when / then
    expect(i18n.t("auth.waiting", { count: 1 })).toBe("Die Anmeldung ist ausgelastet. Neuer Versuch in 1 Sekunde.");
    expect(i18n.t("auth.waiting", { count: 5 })).toBe("Die Anmeldung ist ausgelastet. Neuer Versuch in 5 Sekunden.");
  });

  it("given a successful credential check and stalled session refresh, when the deadline expires, then unlock and cancel the refresh without submitting credentials again", async () => {
    // given
    const login = vi.spyOn(api, "login").mockResolvedValue(undefined);
    const refreshed = vi.fn<(signal?: AbortSignal) => Promise<void>>().mockImplementation(() => new Promise(() => {}));
    render(<MemoryRouter><LoginView refreshSession={refreshed} /></MemoryRouter>);
    await userEvent.type(screen.getByTestId("username"), "doe.jane");
    await userEvent.type(screen.getByTestId("password"), "secret");
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId("login-submit"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    // when
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    // then
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in took too long. Please try again.");
    expect(screen.getByTestId("login-submit")).toBeEnabled();
    expect(refreshed.mock.calls[0][0]?.aborted).toBe(true);
    expect(login).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("given a pending password login, when the holder submits a recovery code, then only the completed factor refreshes account access", async () => {
    // given
    vi.spyOn(api, "login").mockResolvedValue("mfa-required");
    const complete = vi.spyOn(api, "completeMfaLogin").mockResolvedValue(undefined);
    const refreshed = vi.fn().mockResolvedValue(undefined);
    render(<MemoryRouter><LoginView refreshSession={refreshed} /></MemoryRouter>);
    await userEvent.type(screen.getByTestId("username"), "doe.jane");
    await userEvent.type(screen.getByTestId("password"), "private-password");
    // when
    await userEvent.click(screen.getByTestId("login-submit"));
    const code = await screen.findByTestId("login-mfa-code");
    expect(screen.queryByTestId("password")).toBeNull();
    await userEvent.type(code, "ABCD-EFGH-IJKL-MNOP-QRST-UVWX");
    await userEvent.click(screen.getByTestId("login-mfa-submit"));
    // then
    expect(complete).toHaveBeenCalledWith("ABCD-EFGH-IJKL-MNOP-QRST-UVWX", expect.any(AbortSignal));
    expect(refreshed).toHaveBeenCalledTimes(2);
  });

  it("given an interrupted factor challenge, when the holder changes account, then discard the challenge before showing credentials", async () => {
    // given
    const logout = vi.spyOn(api, "logout").mockResolvedValue(undefined);
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<MemoryRouter><LoginView refreshSession={refresh} mfaRequired /></MemoryRouter>);
    // when
    await userEvent.click(screen.getByTestId("login-mfa-restart"));
    // then
    expect(await screen.findByTestId("username")).toHaveValue("");
    expect(logout).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("given an unresponsive factor request, when the sign-in deadline expires, then cancel it and allow another proof", async () => {
    // given
    const complete = vi.spyOn(api, "completeMfaLogin").mockImplementation(() => new Promise(() => undefined));
    render(<MemoryRouter><LoginView refreshSession={vi.fn()} mfaRequired /></MemoryRouter>);
    await userEvent.type(screen.getByTestId("login-mfa-code"), "123456");
    vi.useFakeTimers();
    fireEvent.submit(screen.getByTestId("login-mfa-code").closest("form")!);
    // when
    await act(() => vi.advanceTimersByTimeAsync(15000));
    // then
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in took too long. Please try again.");
    expect(screen.getByTestId("login-mfa-submit")).toBeEnabled();
    expect(complete.mock.calls[0][1]?.aborted).toBe(true);
  });

  it.each(["logout", "refresh"])("given a restart stalled during %s, when its deadline expires, then cancel and allow a new restart", async (phase) => {
    // given
    const logout = vi.spyOn(api, "logout").mockImplementation(() => phase === "logout" ? new Promise(() => undefined) : Promise.resolve());
    const refresh = vi.fn<(signal?: AbortSignal) => Promise<void>>().mockImplementation(() => phase === "refresh" ? new Promise(() => undefined) : Promise.resolve());
    render(<MemoryRouter><LoginView refreshSession={refresh} mfaRequired /></MemoryRouter>);
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId("login-mfa-restart"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    // when
    await act(() => vi.advanceTimersByTimeAsync(15000));
    // then
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in took too long. Please try again.");
    expect(screen.getByTestId("login-mfa-restart")).toBeEnabled();
    expect(screen.getByTestId("login-mfa-submit")).toBeEnabled();
    expect(logout).toHaveBeenCalledOnce();
    if (phase === "refresh") expect(refresh.mock.calls[0][0]?.aborted).toBe(true);
    else expect(logout.mock.calls[0][0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("given a restart waiting for logout, when leaving sign-in, then abort logout and remove its deadline", async () => {
    // given
    const logout = vi.spyOn(api, "logout").mockImplementation(() => new Promise(() => undefined));
    const refresh = vi.fn().mockResolvedValue(undefined);
    const shown = render(<MemoryRouter><LoginView refreshSession={refresh} mfaRequired /></MemoryRouter>);
    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId("login-mfa-restart"));
    // when
    shown.unmount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    // then
    expect(logout.mock.calls[0][0]?.aborted).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

});

it("given a resumed pending login with a security key, when the holder uses it, then refresh only after its assertion succeeds", async () => {
  // given
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", class {});
  const get = vi.fn<(options: CredentialRequestOptions) => Promise<unknown>>().mockResolvedValue({ id: "AQ", rawId: new Uint8Array([1]).buffer, type: "public-key", getClientExtensionResults: () => ({}), response: { authenticatorData: new Uint8Array([1]).buffer, clientDataJSON: new Uint8Array([2]).buffer, signature: new Uint8Array([3]).buffer, userHandle: null } });
  vi.stubGlobal("navigator", { credentials: { create: vi.fn(), get } });
  vi.spyOn(api, "webauthnLoginOptions").mockResolvedValue({ challenge: "AQ", rpId: "example.org", allowCredentials: [], userVerification: "required" });
  const complete = vi.spyOn(api, "completeWebauthnLogin").mockResolvedValue(undefined);
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<MemoryRouter><LoginView mfaRequired webauthnAvailable refreshSession={refresh} /></MemoryRouter>);
  // when
  fireEvent.click(screen.getByTestId("login-security-key"));
  // then
  await screen.findByTestId("login-mfa-code");
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(complete.mock.calls[0][0].response.signature).toBe("Aw");
  expect(screen.queryByTestId("password")).toBeNull();
  vi.unstubAllGlobals();
});

it("given a security key prompt, when Escape cancels it, then leave recovery code sign-in usable and discard late credentials", async () => {
  // given
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", class {});
  const get = vi.fn<(options: CredentialRequestOptions) => Promise<unknown>>().mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("navigator", { credentials: { create: vi.fn(), get } });
  vi.spyOn(api, "webauthnLoginOptions").mockResolvedValue({ challenge: "AQ", rpId: "example.org", allowCredentials: [], userVerification: "required" });
  const complete = vi.spyOn(api, "completeWebauthnLogin").mockResolvedValue(undefined);
  render(<MemoryRouter><LoginView mfaRequired webauthnAvailable refreshSession={vi.fn()} /></MemoryRouter>);
  // when
  fireEvent.click(screen.getByTestId("login-security-key"));
  await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
  fireEvent.keyDown(window, { key: "Escape" });
  // then
  await vi.waitFor(() => expect(screen.getByTestId("login-mfa-code")).toBeEnabled());
  expect(get.mock.calls[0][0].signal?.aborted).toBe(true);
  expect(complete).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it("given a security key prompt that never answers, when the sign-in deadline expires, then say the key timed out and keep codes usable", async () => {
  // given
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", class {});
  const get = vi.fn<(options: CredentialRequestOptions) => Promise<unknown>>().mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("navigator", { credentials: { create: vi.fn(), get } });
  vi.spyOn(api, "webauthnLoginOptions").mockResolvedValue({ challenge: "AQ", rpId: "example.org", allowCredentials: [], userVerification: "required" });
  render(<MemoryRouter><LoginView mfaRequired webauthnAvailable refreshSession={vi.fn()} /></MemoryRouter>);
  vi.useFakeTimers();
  fireEvent.click(screen.getByTestId("login-security-key"));
  await act(() => vi.advanceTimersByTimeAsync(0));
  // when
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  // then
  expect(screen.getByRole("alert")).toHaveTextContent(i18n.t("mfa.keyTimedOut"));
  expect(screen.getByTestId("login-mfa-code")).toBeEnabled();
  expect(get.mock.calls[0][0].signal?.aborted).toBe(true);
});

it("given a security key prompt, when the holder dismisses it, then say the request was cancelled", async () => {
  // given
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", class {});
  vi.stubGlobal("navigator", { credentials: { create: vi.fn(), get: vi.fn().mockRejectedValue(new DOMException("dismissed", "NotAllowedError")) } });
  vi.spyOn(api, "webauthnLoginOptions").mockResolvedValue({ challenge: "AQ", rpId: "example.org", allowCredentials: [], userVerification: "required" });
  render(<MemoryRouter><LoginView mfaRequired webauthnAvailable refreshSession={vi.fn()} /></MemoryRouter>);
  // when
  fireEvent.click(screen.getByTestId("login-security-key"));
  // then
  expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("mfa.keyCancelled"));
});
