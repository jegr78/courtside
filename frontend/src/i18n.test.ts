import { beforeEach, describe, expect, it } from "vitest";
import { explicitLocale, shippedLocales, supportedLocale } from "./i18n";

describe("i18n", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
});
