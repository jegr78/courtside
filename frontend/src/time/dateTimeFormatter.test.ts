import { afterEach, beforeEach, expect, it, vi } from "vitest";

let dateTimeFormatter: typeof import("./dateTimeFormatter").dateTimeFormatter;

beforeEach(async () => {
  vi.resetModules();
  ({ dateTimeFormatter } = await import("./dateTimeFormatter"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("given repeated formatting options, when formatting different dates, then reuse the formatter without caching formatted values", () => {
  // given
  const options = { timeZone: "UTC", year: "numeric" } as const;
  // when
  const first = dateTimeFormatter("en", options);
  const repeated = dateTimeFormatter("en", { ...options });
  // then
  expect(repeated).toBe(first);
  expect(first.format(new Date("2026-01-01T12:00:00Z"))).toBe("2026");
  expect(repeated.format(new Date("2027-01-01T12:00:00Z"))).toBe("2027");
});

it("given equivalent options in different orders, when requesting a formatter, then reuse one canonical configuration", () => {
  // given
  const first = dateTimeFormatter("en", { timeZone: "UTC", year: "numeric" });
  // when
  const repeated = dateTimeFormatter("en", { year: "numeric", month: undefined, timeZone: "UTC" });
  // then
  expect(repeated).toBe(first);
});

it("given different locale time zone and hour-cycle settings, when requesting formatters, then configurations do not alias", () => {
  // given
  const options = { timeZone: "UTC", hour: "2-digit", hourCycle: "h23" } as const;
  const first = dateTimeFormatter("en", options);
  // when
  const german = dateTimeFormatter("de", options);
  const berlin = dateTimeFormatter("en", { ...options, timeZone: "Europe/Berlin" });
  const twelveHour = dateTimeFormatter("en", { ...options, hourCycle: "h12" });
  // then
  expect(german).not.toBe(first);
  expect(berlin).not.toBe(first);
  expect(twelveHour).not.toBe(first);
  expect(berlin.format(new Date("2026-01-01T12:00:00Z"))).toBe("13");
  expect(twelveHour.format(new Date("2026-01-01T12:00:00Z"))).toBe("12 PM");
});

it("given cached formatting options, when the caller changes its object, then the old formatter stays isolated", () => {
  // given
  const options: Intl.DateTimeFormatOptions = { timeZone: "UTC", year: "numeric" };
  const first = dateTimeFormatter("en", options);
  // when
  options.year = "2-digit";
  const changed = dateTimeFormatter("en", options);
  // then
  expect(changed).not.toBe(first);
  expect(first.format(new Date("2026-01-01T12:00:00Z"))).toBe("2026");
  expect(changed.format(new Date("2026-01-01T12:00:00Z"))).toBe("26");
});

it("given a full formatter cache, when a new configuration arrives, then evict the oldest object instead of growing indefinitely", () => {
  // given
  const first = dateTimeFormatter("en-x-cache0", { timeZone: "UTC" });
  for (let index = 1; index < 64; index++) dateTimeFormatter(`en-x-cache${index}`, { timeZone: "UTC" });
  // when
  expect(dateTimeFormatter("en-x-cache0", { timeZone: "UTC" })).toBe(first);
  dateTimeFormatter("en-x-cache64", { timeZone: "UTC" });
  const recreated = dateTimeFormatter("en-x-cache0", { timeZone: "UTC" });
  // then
  expect(recreated).not.toBe(first);
  expect(recreated.resolvedOptions().timeZone).toBe("UTC");
});

it("given an invalid time zone or incompatible format options, when requesting a formatter, then preserve Intl rejection and do not poison valid entries", () => {
  // given
  const valid = dateTimeFormatter("en", { timeZone: "UTC" });
  // when / then
  expect(() => dateTimeFormatter("en", { timeZone: "Invalid/Zone" })).toThrow(RangeError);
  expect(() => dateTimeFormatter("en", { dateStyle: "short", year: "numeric" })).toThrow(TypeError);
  expect(dateTimeFormatter("en", { timeZone: "UTC" })).toBe(valid);
});

it("given a cached club-zone formatter, when daylight saving changes the offset, then each instant retains its correct wall-clock time", () => {
  // given
  const formatter = dateTimeFormatter("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  // when
  const before = formatter.format(new Date("2026-03-29T00:30:00Z"));
  const after = formatter.format(new Date("2026-03-29T01:30:00Z"));
  // then
  expect(before).toBe("01:30");
  expect(after).toBe("03:30");
});

it("given many court-plan slots in one club zone, when resolving their instants, then construct each shared formatter only once", async () => {
  // given
  const { zonedDateTime } = await import("./clubZone");
  const constructor = vi.spyOn(Intl, "DateTimeFormat");
  // when
  for (let hour = 8; hour < 20; hour++) {
    zonedDateTime("2026-10-05", `${String(hour).padStart(2, "0")}:00`, "Europe/Berlin");
  }
  // then
  expect(constructor).toHaveBeenCalledTimes(2);
});

it("given formatting options inherited from a prototype, when requesting a formatter, then inherited Intl settings cannot alias another zone", () => {
  // given
  vi.stubEnv("TZ", "UTC");
  const utc = dateTimeFormatter("en", { timeZone: "UTC", hour: "2-digit", hourCycle: "h23" });
  const inherited = Object.create({ timeZone: "Europe/Berlin" }) as Intl.DateTimeFormatOptions;
  inherited.hour = "2-digit";
  inherited.hourCycle = "h23";
  // when
  const berlin = dateTimeFormatter("en", inherited);
  // then
  expect(berlin).not.toBe(utc);
  expect(berlin.format(new Date("2026-01-01T12:00:00Z"))).toBe("13");
});

it("given an implicit system zone, when the system zone changes, then use the current zone rather than a stale cached formatter", () => {
  // given
  vi.stubEnv("TZ", "UTC");
  const instant = new Date("2026-10-04T22:30:00Z");
  const first = dateTimeFormatter("en", { weekday: "long" });
  // when
  vi.stubEnv("TZ", "Europe/Berlin");
  const changed = dateTimeFormatter("en", { weekday: "long" });
  // then
  expect(first.format(instant)).toBe("Sunday");
  expect(changed.format(instant)).toBe("Monday");
  expect(changed).not.toBe(first);
});

it("given an inherited prototype option shadowed with undefined, when taking the formatter snapshot, then preserve the explicit undefined value", () => {
  // given
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "year");
  Object.defineProperty(Object.prototype, "year", { value: "numeric", configurable: true });
  try {
    const options = { year: undefined, month: "long", timeZone: "UTC" } as const;
    // when
    const formatter = dateTimeFormatter("en", options);
    // then
    expect(formatter.format(new Date("2026-01-01T12:00:00Z"))).toBe("January");
  } finally {
    if (original) Object.defineProperty(Object.prototype, "year", original);
    else Reflect.deleteProperty(Object.prototype, "year");
  }
});

it("given an externally coerced option changes its string value, when taking a new snapshot, then its new Intl meaning cannot reuse the old formatter", () => {
  // given
  let zone = "UTC";
  const options: Intl.DateTimeFormatOptions = { timeZone: { toString: () => zone } as unknown as string, hour: "2-digit", hourCycle: "h23" };
  const first = dateTimeFormatter("en", options);
  // when
  zone = "Europe/Berlin";
  const changed = dateTimeFormatter("en", options);
  // then
  expect(changed).not.toBe(first);
  expect(first.format(new Date("2026-01-01T12:00:00Z"))).toBe("12");
  expect(changed.format(new Date("2026-01-01T12:00:00Z"))).toBe("13");
});
