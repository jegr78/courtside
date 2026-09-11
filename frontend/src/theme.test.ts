import { beforeEach, describe, expect, it } from "vitest";
import { initialTheme, setTheme } from "./theme";

describe("theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("given a stored appearance that is not the light one, when the theme is read, then the page stays dark", () => {
    // given / when / then
    for (const stored of ["Light", "LIGHT", " light", "light ", "1", "true", "dark", "{}"]) {
      window.localStorage.setItem("courtside.theme", stored);
      expect(initialTheme()).toBe("dark");
    }
  });

  it("given nothing stored, when the theme is read, then the page is dark", () => {
    // when / then
    expect(initialTheme()).toBe("dark");
  });

  it("given the light appearance was chosen, when the theme is read, then it is light", () => {
    // given
    setTheme("light");

    // when / then
    expect(initialTheme()).toBe("light");
  });
});
