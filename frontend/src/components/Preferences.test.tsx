import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import i18n, { applyAccountLocale, initialLocale } from "../i18n";
import { applyTheme } from "../theme";
import { Preferences } from "./Preferences";

beforeEach(async () => {
  vi.restoreAllMocks();
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  } });
  window.localStorage.clear();
  applyTheme("dark");
  await i18n.changeLanguage("de");
});

async function openPreferences() {
  await userEvent.click(screen.getByTestId("preferences-menu"));
}

it("given preferences chosen once, when the header is shown, then they stay inside a compact account menu", async () => {
  // given
  render(<Preferences authenticated signedOut={() => undefined} />);

  // when
  const menu = screen.getByTestId("preferences-menu");

  // then
  expect(menu).toHaveTextContent("Konto und Darstellung");
  expect(document.getElementById("locale-preference")).not.toBeVisible();
  expect(document.getElementById("theme-preference")).not.toBeVisible();

  // when
  await userEvent.click(menu);

  // then
  expect(document.getElementById("locale-preference")).toBeVisible();
  expect(document.getElementById("theme-preference")).toBeVisible();
});

it("when no theme was selected, then dark mode is the default", () => {
  // when
  render(<Preferences signedOut={() => undefined} />);

  // then
  expect(document.documentElement).toHaveClass("dark");
  expect(document.getElementById("theme-preference")).toHaveValue("dark");
});

it("given dark mode, when selecting light mode, then the preference is applied and stored", async () => {
  // given
  render(<Preferences signedOut={() => undefined} />);
  await openPreferences();

  // when
  await userEvent.selectOptions(document.getElementById("theme-preference")!, "light");

  // then
  expect(document.documentElement).not.toHaveClass("dark");
  expect(document.documentElement).toHaveClass("light");
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  expect(window.localStorage.getItem("courtside.theme")).toBe("light");
});

it("given German, when selecting English, then the whole interface uses and stores English", async () => {
  // given
  render(<Preferences signedOut={() => undefined} />);
  await openPreferences();

  // when
  await userEvent.selectOptions(document.getElementById("locale-preference")!, "en");

  // then
  expect(document.documentElement).toHaveAttribute("lang", "en");
  expect(document.getElementById("locale-preference")).toHaveValue("en");
  expect(window.localStorage.getItem("courtside.locale")).toBe("en");
});

it("given no language preference, when determining the locale, then German is the default", () => {
  // when
  const locale = initialLocale();

  // then
  expect(locale).toBe("de");
});

it("given an explicit language preference, when an account has another locale, then the preference is kept", async () => {
  // given
  window.localStorage.setItem("courtside.locale", "en");
  await i18n.changeLanguage("en");

  // when
  await applyAccountLocale("de");

  // then
  expect(i18n.resolvedLanguage).toBe("en");
  expect(document.documentElement).toHaveAttribute("lang", "en");
});

it("given a signed in member, when selecting another language, then the account is told so the next message follows", async () => {
  // given
  const stored = vi.spyOn(api, "changeOwnLocale").mockResolvedValue(undefined);
  render(<Preferences authenticated signedOut={() => undefined} />);
  await openPreferences();

  // when
  await userEvent.selectOptions(document.getElementById("locale-preference")!, "en");

  // then
  expect(stored).toHaveBeenCalledWith("en");
});

it("given nobody signed in, when selecting another language, then no account is written to", async () => {
  // given
  const stored = vi.spyOn(api, "changeOwnLocale").mockResolvedValue(undefined);
  render(<Preferences signedOut={() => undefined} />);
  await openPreferences();

  // when
  await userEvent.selectOptions(document.getElementById("locale-preference")!, "en");

  // then
  expect(stored).not.toHaveBeenCalled();
  expect(i18n.resolvedLanguage).toBe("en");
});

it("given the account refuses the change, when selecting another language, then the member is told rather than nothing", async () => {
  // given
  vi.spyOn(api, "changeOwnLocale").mockRejectedValue(new ApiError(403));
  render(<Preferences authenticated signedOut={() => undefined} />);
  await openPreferences();

  // when
  await userEvent.selectOptions(document.getElementById("locale-preference")!, "en");

  // then — the page has already switched, so silence would leave the two disagreeing unnoticed
  expect(await screen.findByTestId("preferences-failure")).toBeInTheDocument();
  await userEvent.click(screen.getByTestId("preferences-menu"));
  expect(screen.getByTestId("preferences-failure")).toBeVisible();
});

it("given an instance that ships one language, when offering the choice, then only that one is offered", () => {
  // when
  render(<Preferences supported={["de"]} signedOut={() => undefined} />);

  // then
  expect(Array.from(document.getElementById("locale-preference")!.children)
    .map((option) => option.getAttribute("value"))).toEqual(["de"]);
});

it("given an administrator deep in an administrative page, when signing out, then no detour is needed", async () => {
  // given
  const signedOut = vi.fn();
  vi.spyOn(api, "logout").mockResolvedValue();
  render(<Preferences authenticated signedOut={signedOut} />);
  await openPreferences();

  // when
  await userEvent.click(screen.getByTestId("logout"));

  // then
  expect(api.logout).toHaveBeenCalled();
  expect(signedOut).toHaveBeenCalled();
});

// Left standing, the panel covers the page it was opened over, and the next click on the control
// that opens it closes it instead.
it("given the account menu is open, when signing out succeeds, then the menu closes behind it", async () => {
  // given
  vi.spyOn(api, "logout").mockResolvedValue();
  render(<Preferences authenticated signedOut={() => undefined} />);
  await openPreferences();

  // when
  await userEvent.click(screen.getByTestId("logout"));

  // then
  expect(screen.getByTestId("preferences-menu").closest("details")).not.toHaveAttribute("open");
});

it("given signing out fails, when it is attempted, then the menu stays open beside the failure", async () => {
  // given
  vi.spyOn(api, "logout").mockRejectedValue(new Error("network"));
  render(<Preferences authenticated signedOut={() => undefined} />);
  await openPreferences();

  // when
  await userEvent.click(screen.getByTestId("logout"));

  // then
  expect(await screen.findByTestId("preferences-failure")).toBeInTheDocument();
  expect(screen.getByTestId("preferences-menu").closest("details")).toHaveAttribute("open");
});

it("given signing out fails, when it is attempted, then the failure is shown and the session is kept", async () => {
  // given
  const signedOut = vi.fn();
  vi.spyOn(api, "logout").mockRejectedValue(new Error("network"));
  render(<Preferences authenticated signedOut={signedOut} />);
  await openPreferences();

  // when
  await userEvent.click(screen.getByTestId("logout"));

  // then
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(signedOut).not.toHaveBeenCalled();
});

it("given the instance has already ended the session, when signing out, then it ends signed out without a failure", async () => {
  // given
  const signedOut = vi.fn();
  vi.spyOn(api, "logout").mockRejectedValue(new ApiError(401, {
    type: "urn:courtside:error:unauthenticated",
    title: "Not authenticated",
    status: 401
  }));
  render(<Preferences authenticated signedOut={signedOut} />);
  await openPreferences();

  // when
  await userEvent.click(screen.getByTestId("logout"));

  // then
  await waitFor(() => expect(signedOut).toHaveBeenCalled());
  expect(screen.queryByTestId("preferences-failure")).not.toBeInTheDocument();
  expect(screen.getByTestId("preferences-menu").closest("details")).not.toHaveAttribute("open");
});

it("given nobody is signed in, when the menu is opened, then it offers nothing to sign out of", async () => {
  // given
  render(<Preferences signedOut={() => undefined} />);

  // when
  await openPreferences();

  // then
  expect(screen.queryByTestId("logout")).not.toBeInTheDocument();
});
