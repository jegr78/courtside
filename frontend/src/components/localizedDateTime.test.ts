import { expect, it } from "vitest";
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
