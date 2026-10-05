import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError, api } from "../api/client";
import i18n from "../i18n";
import { LoginView } from "./LoginView";

describe("LoginView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  afterEach(() => vi.useRealTimers());

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
    const login = vi.spyOn(api, "login").mockRejectedValueOnce(refusal).mockResolvedValueOnce();
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
    const login = vi.spyOn(api, "login").mockResolvedValue();
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
});
