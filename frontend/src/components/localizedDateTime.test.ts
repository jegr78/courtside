import { expect, it } from "vitest";
import type { DateTimeType } from "./DateTimeInput";
import { formatDateTime, parseDateTime } from "./localizedDateTime";

it("given application locales, when wall dates and times are formatted, then their formats follow that locale", () => {
  // when / then
  expect(formatDateTime("2026-10-03", "date", "de")).toBe("03.10.2026");
  expect(formatDateTime("2026-10-03", "date", "en")).toBe("10/03/2026");
  expect(formatDateTime("16:05", "time", "de")).toBe("16:05");
  expect(formatDateTime("16:05", "time", "en")).toBe("04:05 PM");
  expect(formatDateTime("2026-10-03T00:05:12", "datetime-local", "en")).toBe("10/03/2026 12:05:12 AM");
});

it("given localized values, when parsed, then valid dates and twelve-hour boundaries keep canonical wall values", () => {
  // when / then
  expect(parseDateTime("29.02.2028", "date", "de")).toBe("2028-02-29");
  expect(parseDateTime("10/03/2026 12:00 AM", "datetime-local", "en")).toBe("2026-10-03T00:00");
  expect(parseDateTime("12:00 PM", "time", "en")).toBe("12:00");
  expect(parseDateTime("11:59:42 PM", "time", "en")).toBe("23:59:42");
  expect(parseDateTime("2026-10-03T16:05", "datetime-local", "de")).toBe("2026-10-03T16:05");
});

it("given impossible or partial components, when parsed, then they never roll into another date or time", () => {
  // when / then
  for (const date of ["29.02.2026", "31.04.2026", "00.12.2026", "01.13.2026", "1.2.", "2026-02-29"]) {
    expect(parseDateTime(date, "date", "de"), date).toBeNull();
  }
  for (const time of ["24:00", "12:60", "12:30:60", "1:", "00:30 PM", "13:00 AM"]) {
    expect(parseDateTime(time, "time", time.includes("M") ? "en" : "de"), time).toBeNull();
  }
});

it("given common spellings with single digits, spaces or a joined day period, when parsed, then they keep their canonical wall values", () => {
  // given
  const cases: [string, DateTimeType, string, string][] = [
    ["1.1.2027", "date", "de", "2027-01-01"],
    ["1. 2. 2026", "date", "de", "2026-02-01"],
    ["1/2/2026", "date", "en", "2026-01-02"],
    ["8:00", "time", "de", "08:00"],
    ["8:05", "time", "en", "08:05"],
    ["4:05 PM", "time", "en", "16:05"],
    ["04:05PM", "time", "en", "16:05"],
    ["4:05pm", "time", "en", "16:05"],
    ["1.2.2026 8:00", "datetime-local", "de", "2026-02-01T08:00"],
    ["1. 2. 2026 8:00", "datetime-local", "de", "2026-02-01T08:00"],
    ["1/2/2026 4:05 PM", "datetime-local", "en", "2026-01-02T16:05"]
  ];

  // when / then
  for (const [text, type, locale, expected] of cases) {
    expect(parseDateTime(text, type, locale), `${text} in ${locale}`).toBe(expected);
  }
});

it("given a two-digit year or a one-digit minute, when parsed, then the value is refused rather than guessed", () => {
  // when / then
  for (const [text, type, locale] of [["01.02.26", "date", "de"], ["1/2/26", "date", "en"], ["8:5", "time", "de"], ["1.2.202", "date", "de"]] as const) {
    expect(parseDateTime(text, type, locale), text).toBeNull();
  }
});
