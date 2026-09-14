const LOCALE = /^[a-z]{2}-[A-Z]{2}$/;

// A club names its cards, rule sets and membership types once, in its own language, so the club a
// guide shows has to speak the language that guide is published in: a German name under an English
// passage describes a club the reader will never have.
export function clubLanguage(locale: string | undefined): string | undefined {
  if (locale === undefined) return undefined;
  if (!LOCALE.test(locale)) throw new Error(`Unsupported capture locale: ${locale}`);
  return locale.slice(0, 2);
}
