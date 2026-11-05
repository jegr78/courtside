function fractionDigits(locale: string, currency: string): number {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

export function formatMinor(minor: number, locale: string, currency: string): string {
  const digits = fractionDigits(locale, currency);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 10 ** digits);
}

// Integer arithmetic, because 0.29 * 100 is not 29 in floating point.
export function parseMinor(text: string, currency: string): number | undefined {
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(text.trim());
  if (!match) return undefined;
  const [, whole, fraction = ""] = match;
  const digits = fractionDigits("en", currency);
  if (fraction.length > digits) return undefined;
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : undefined;
}

export function minorAsDecimal(minor: number, locale: string, currency: string): string {
  const digits = fractionDigits(locale, currency);
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })
    .format(minor / 10 ** digits);
}
