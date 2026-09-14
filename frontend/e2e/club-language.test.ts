import { describe, expect, it } from "vitest";
import { clubLanguage } from "./club-language";

describe("clubLanguage", () => {
  it("given a project that publishes nothing, when its club is chosen, then it keeps the shipped one", () => {
    expect(clubLanguage(undefined)).toBeUndefined();
  });

  it("given a project published in a language, when its club is chosen, then the club speaks it", () => {
    expect(clubLanguage("de-DE")).toBe("de");
    expect(clubLanguage("en-GB")).toBe("en");
  });

  it("given anything but a locale, when a club is chosen for it, then it is refused rather than guessed", () => {
    for (const locale of ["de", "de_DE", "DE-de", "../etc", ""]) {
      expect(() => clubLanguage(locale)).toThrow(`Unsupported capture locale: ${locale}`);
    }
  });
});
