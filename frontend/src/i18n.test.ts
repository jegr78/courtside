import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n, { explicitLocale, localeBundles, setLocale, shippedLocales, supportedLocale } from "./i18n";
import en from "./locales/en";

describe("i18n", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await i18n.changeLanguage("de");
    document.documentElement.lang = "de";
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    i18n.addResourceBundle("en", "translation", en);
    await i18n.changeLanguage("de");
  });

  it("given a stored language this build does not ship, when the language is read, then the default is used", () => {
    // given / when / then
    for (const stored of ["fr", "xx", "", "1", "de,en", "{}", "../de"]) {
      window.localStorage.setItem("courtside.locale", stored);
      expect(explicitLocale()).toBeUndefined();
    }
  });

  it("given a stored language this build ships, when the language is read, then it is that one", () => {
    // given
    window.localStorage.setItem("courtside.locale", "en-GB");

    // when / then
    expect(explicitLocale()).toBe("en");
    expect(shippedLocales).toContain("en");
  });

  it("given no language is stored, when the language is read, then none is claimed", () => {
    // when / then
    expect(explicitLocale()).toBeUndefined();
    expect(supportedLocale(null)).toBeUndefined();
  });

  it("given a language not loaded yet, when it is chosen, then its bundle arrives before the page switches", async () => {
    // given
    i18n.removeResourceBundle("en", "translation");

    // when
    await setLocale("en");

    // then
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
    expect(i18n.t("preferences.language")).toBe("Language");
    expect(document.documentElement.lang).toBe("en");
    expect(explicitLocale()).toBe("en");
  });

  it("given a language whose bundle cannot be fetched, when it is chosen, then the page keeps its language", async () => {
    // given
    i18n.removeResourceBundle("en", "translation");
    vi.spyOn(localeBundles, "en").mockRejectedValue(new TypeError("Failed to fetch dynamically imported module"));

    // when / then
    await expect(setLocale("en")).rejects.toThrow(TypeError);
    expect(i18n.language).toBe("de");
    expect(i18n.t("preferences.language")).toBe("Sprache");
    expect(document.documentElement.lang).toBe("de");
    expect(explicitLocale()).toBeUndefined();
  });

  it("given a language still arriving, when another is chosen meanwhile, then the later choice stays", async () => {
    // given
    i18n.removeResourceBundle("en", "translation");
    let arrive: (bundle: typeof en) => void = () => undefined;
    vi.spyOn(localeBundles, "en").mockReturnValue(new Promise((resolve) => { arrive = resolve; }));
    const slow = setLocale("en");

    // when
    await setLocale("de");
    arrive(en);

    // then
    expect(await slow, "an overtaken choice must not report itself applied").toBe(false);
    expect(i18n.language).toBe("de");
    expect(document.documentElement.lang).toBe("de");
    expect(explicitLocale()).toBe("de");
  });
});
