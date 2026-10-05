const maximumFormatters = 64;
const formatters = new Map<string, Intl.DateTimeFormat>();
const optionNames: (keyof Intl.DateTimeFormatOptions)[] = [
  "localeMatcher", "calendar", "numberingSystem", "hour12", "hourCycle", "timeZone", "weekday", "era",
  "year", "month", "day", "dayPeriod", "hour", "minute", "second", "fractionalSecondDigits",
  "timeZoneName", "formatMatcher", "dateStyle", "timeStyle"
];

export function dateTimeFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const snapshot = Object.create(null) as Intl.DateTimeFormatOptions;
  for (const name of optionNames) {
    const raw = options[name];
    const value = name === "timeZone" && raw === undefined
      ? new Intl.DateTimeFormat().resolvedOptions().timeZone : raw;
    if (value === undefined) continue;
    const normalized = name === "hour12" ? Boolean(value)
      : name === "fractionalSecondDigits" ? Number(value) : `${value}`;
    Object.defineProperty(snapshot, name, { value: normalized, enumerable: true });
  }
  const key = JSON.stringify([locale, snapshot]);
  const cached = formatters.get(key);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat(locale, snapshot);
  if (formatters.size === maximumFormatters) formatters.delete(formatters.keys().next().value!);
  formatters.set(key, formatter);
  return formatter;
}
