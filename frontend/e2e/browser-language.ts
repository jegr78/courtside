const LOCALE = /^[a-z]{2}-[A-Z]{2}$/;

export interface BrowserLanguage {
  environment: Record<string, string>;
  launchOptions: Record<string, unknown>;
}

// A date, a time and a file control are drawn by the browser process, which reads LANGUAGE and not
// the context's locale, and only the full build carries the strings the headless shell has none of.
export function browserLanguage(browserName: string, locale: string | undefined): BrowserLanguage {
  if (locale === undefined) return { environment: {}, launchOptions: {} };
  if (!LOCALE.test(locale)) throw new Error(`Unsupported capture locale: ${locale}`);
  // Only the Chromium build was measured to follow LANGUAGE, and a channel means nothing to the
  // other two, so an engine that has not been shown to answer is refused rather than guessed at.
  if (browserName !== "chromium") throw new Error(`Only chromium can be started in a language: ${browserName}`);
  return {
    environment: { LANGUAGE: locale.replace("-", "_") },
    launchOptions: { channel: "chromium" }
  };
}
