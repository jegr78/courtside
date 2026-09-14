import { describe, expect, it } from "vitest";
import { browserLanguage } from "./browser-language";

describe("browserLanguage", () => {
  it("given a project without a locale, when its browser is configured, then it stays the shared one", () => {
    // when
    const settings = browserLanguage("webkit", undefined);

    // then
    expect(settings).toEqual({ environment: {}, launchOptions: {} });
  });

  it("given a project that declares German, when its browser is configured, then the process speaks it", () => {
    // when
    const settings = browserLanguage("chromium", "de-DE");

    // then
    expect(settings).toEqual({
      environment: { LANGUAGE: "de_DE" },
      launchOptions: { channel: "chromium" }
    });
  });

  it("given a project that declares British English, when its browser is configured, then the process speaks it", () => {
    // when
    const settings = browserLanguage("chromium", "en-GB");

    // then
    expect(settings).toEqual({
      environment: { LANGUAGE: "en_GB" },
      launchOptions: { channel: "chromium" }
    });
  });

  it("given an engine no capture was measured in, when a locale is asked of it, then it is refused", () => {
    // when / then
    expect(() => browserLanguage("webkit", "de-DE")).toThrow(/Only chromium can be started in a language: webkit/);
    expect(() => browserLanguage("firefox", "de-DE")).toThrow(/Only chromium can be started in a language: firefox/);
  });

  it("given a locale no browser could be started for, when it is read, then it is refused rather than passed on", () => {
    // when / then
    expect(() => browserLanguage("chromium", "de")).toThrow(/Unsupported capture locale: de/);
    expect(() => browserLanguage("chromium", "de_DE")).toThrow(/Unsupported capture locale: de_DE/);
    expect(() => browserLanguage("chromium", "../etc")).toThrow(/Unsupported capture locale/);
  });
});
