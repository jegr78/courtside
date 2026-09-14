const LOCALE = /^[a-z]{2}-[A-Z]{2}$/;

// A club names its rows once, in its own language, so the club a guide shows has to speak the
// language that guide is published in rather than the one the instance happens to ship with.
export function clubLanguage(locale: string | undefined): string | undefined {
  if (locale === undefined) return undefined;
  if (!LOCALE.test(locale)) throw new Error(`Unsupported capture locale: ${locale}`);
  return locale.slice(0, 2);
}
