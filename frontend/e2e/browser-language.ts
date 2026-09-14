const LOCALE = /^[a-z]{2}-[A-Z]{2}$/;

export interface BrowserLanguage {
  environment: Record<string, string>;
  launchOptions: Record<string, unknown>;
}

// A date, a time and a file control are drawn by the browser process, which reads LANGUAGE and not
// the context's locale, and only the full build carries the strings the headless shell has none of.
export function browserLanguage(locale: string | undefined): BrowserLanguage {
  if (locale === undefined) return { environment: {}, launchOptions: {} };
  if (!LOCALE.test(locale)) throw new Error(`Unsupported capture locale: ${locale}`);
  return {
    environment: { LANGUAGE: locale.replace("-", "_") },
    launchOptions: { channel: "chromium" }
  };
}
