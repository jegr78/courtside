const serverDigits = new Map<string, number>();

/** Records the fraction digits the server stores and charges a currency in; they win over the browser's. */
export function rememberFractionDigits(currency: string, digits: number): void {
  serverDigits.set(currency, digits);
}

function fractionDigits(locale: string, currency: string): number {
  return serverDigits.get(currency)
    ?? new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

function currencyFormat(locale: string, currency: string, digits: number, signDisplay?: "exceptZero"): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, {
    style: "currency", currency, signDisplay, minimumFractionDigits: digits, maximumFractionDigits: digits
  });
}

export function formatMinor(minor: number, locale: string, currency: string): string {
  const digits = fractionDigits(locale, currency);
  return currencyFormat(locale, currency, digits).format(minor / 10 ** digits);
}

export function formatSignedMinor(minor: number, locale: string, currency: string): string {
  const digits = fractionDigits(locale, currency);
  return currencyFormat(locale, currency, digits, "exceptZero").format(minor / 10 ** digits);
}

// Integer arithmetic, because 0.29 * 100 is not 29 in floating point.
export function parseMinor(text: string, currency: string): number | undefined {
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(text.trim());
  if (!match) return undefined;
  const [, whole, fraction = ""] = match;
  const digits = serverDigits.get(currency);
  if (digits === undefined) return undefined;
  if (fraction.length > digits) return undefined;
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : undefined;
}

export function minorAsDecimal(minor: number, locale: string, currency: string): string {
  const digits = fractionDigits(locale, currency);
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })
    .format(minor / 10 ** digits);
}
