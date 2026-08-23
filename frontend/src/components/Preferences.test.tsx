import { render, screen } from "@testing-library/react";
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

it("whenNoThemeWasSelected_thenDarkModeIsTheDefault", () => {
  // when
  render(<Preferences />);

  // then
  expect(document.documentElement).toHaveClass("dark");
  expect(document.getElementById("theme-preference")).toHaveValue("dark");
});

it("givenDarkMode_whenSelectingLightMode_thenThePreferenceIsAppliedAndStored", async () => {
  // given
  render(<Preferences />);

  // when
  await userEvent.selectOptions(document.getElementById("theme-preference")!, "light");

  // then
  expect(document.documentElement).not.toHaveClass("dark");
  expect(document.documentElement).toHaveClass("light");
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  expect(window.localStorage.getItem("courtside.theme")).toBe("light");
});

it("givenGerman_whenSelectingEnglish_thenTheWholeInterfaceUsesAndStoresEnglish", async () => {
  // given
  render(<Preferences />);

  // when
  await userEvent.selectOptions(document.getElementById("locale-preference")!, "en");

  // then
  expect(document.documentElement).toHaveAttribute("lang", "en");
  expect(document.getElementById("locale-preference")).toHaveValue("en");
  expect(window.localStorage.getItem("courtside.locale")).toBe("en");
});

it("givenNoLanguagePreference_whenDeterminingTheLocale_thenGermanIsTheDefault", () => {
  // when
  const locale = initialLocale();

  // then
  expect(locale).toBe("de");
});

it("givenAnExplicitLanguagePreference_whenAnAccountHasAnotherLocale_thenThePreferenceIsKept", async () => {
  // given
  window.localStorage.setItem("courtside.locale", "en");
  await i18n.changeLanguage("en");

  // when
  await applyAccountLocale("de");

  // then
  expect(i18n.resolvedLanguage).toBe("en");
  expect(document.documentElement).toHaveAttribute("lang", "en");
});

it("givenASignedInMember_whenSelectingAnotherLanguage_thenTheAccountIsToldSoTheNextMessageFollows", async () => {
  // given
  const stored = vi.spyOn(api, "changeOwnLocale").mockResolvedValue(undefined);
  render(<Preferences authenticated />);

  // when
  await userEvent.selectOptions(document.getElementById("locale-preference")!, "en");

  // then
  expect(stored).toHaveBeenCalledWith("en");
});

it("givenNobodySignedIn_whenSelectingAnotherLanguage_thenNoAccountIsWrittenTo", async () => {
  // given
  const stored = vi.spyOn(api, "changeOwnLocale").mockResolvedValue(undefined);
  render(<Preferences />);

  // when
  await userEvent.selectOptions(document.getElementById("locale-preference")!, "en");

  // then
  expect(stored).not.toHaveBeenCalled();
  expect(i18n.resolvedLanguage).toBe("en");
});

it("givenTheAccountRefusesTheChange_whenSelectingAnotherLanguage_thenTheMemberIsToldRatherThanNothing", async () => {
  // given
  vi.spyOn(api, "changeOwnLocale").mockRejectedValue(new ApiError(403));
  render(<Preferences authenticated />);

  // when
  await userEvent.selectOptions(document.getElementById("locale-preference")!, "en");

  // then — the page has already switched, so silence would leave the two disagreeing unnoticed
  expect(await screen.findByTestId("locale-not-stored")).toBeInTheDocument();
});

it("givenAnInstanceThatShipsOneLanguage_whenOfferingTheChoice_thenOnlyThatOneIsOffered", () => {
  // when
  render(<Preferences supported={["de"]} />);

  // then
  expect(Array.from(document.getElementById("locale-preference")!.children)
    .map((option) => option.getAttribute("value"))).toEqual(["de"]);
});
