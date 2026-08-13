import { expect, it } from "vitest";
import { bookingTimeSlot, isPastSlot, isValidZonedDateTime, zonedDateTime } from "./clubZone";

const localTimeIn = (isoInstant: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  }).format(new Date(isoInstant));

it("given a slot before a spring-forward transition, when resolving its zoned instant, then it matches that wall-clock time", () => {
  // given
  const date = "2026-03-29";
  const time = "01:30";
  const timeZone = "Europe/Berlin";

  // when
  const instant = zonedDateTime(date, time, timeZone);

  // then
  expect(localTimeIn(instant, timeZone)).toBe("29/03/2026, 01:30");
});

it("given a slot after a fall-back transition, when resolving its zoned instant, then it matches that wall-clock time", () => {
  // given
  const date = "2026-10-25";
  const time = "01:30";
  const timeZone = "Europe/Berlin";

  // when
  const instant = zonedDateTime(date, time, timeZone);

  // then
  expect(localTimeIn(instant, timeZone)).toBe("25/10/2026, 01:30");
});

it("when resolving an ordinary slot, then it matches that wall-clock time", () => {
  // when
  const instant = zonedDateTime("2026-05-12", "18:00", "Europe/Berlin");

  // then
  expect(localTimeIn(instant, "Europe/Berlin")).toBe("12/05/2026, 18:00");
});

it("given a zone with a half-hour transition, when resolving a slot's zoned instant, then it matches that wall-clock time", () => {
  // given
  const date = "2026-10-04";
  const time = "02:30";
  const timeZone = "Australia/Lord_Howe";

  // when
  const instant = zonedDateTime(date, time, timeZone);

  // then
  expect(localTimeIn(instant, timeZone)).toBe("04/10/2026, 02:30");
});

it("given a zone ahead of UTC, when resolving a slot's zoned instant, then it matches that wall-clock time", () => {
  // given
  const date = "2026-09-27";
  const time = "01:30";
  const timeZone = "Pacific/Auckland";

  // when
  const instant = zonedDateTime(date, time, timeZone);

  // then
  expect(localTimeIn(instant, timeZone)).toBe("27/09/2026, 01:30");
});

it("given a slot before now, when checking whether it is past, then it is true", () => {
  // given
  const now = new Date("2026-05-12T16:00:00Z");

  // when
  const past = isPastSlot("2026-05-12", "17:00", "Europe/Berlin", now);

  // then
  expect(past).toBe(true);
});

it("given a slot after now, when checking whether it is past, then it is false", () => {
  // given
  const now = new Date("2026-05-12T16:00:00Z");

  // when
  const past = isPastSlot("2026-05-12", "19:00", "Europe/Berlin", now);

  // then
  expect(past).toBe(false);
});

it("given a slot in the hour before a spring-forward transition and now just before that transition, when checking whether it is past, then it is false", () => {
  // given
  const now = new Date("2026-03-29T00:00:00Z");

  // when
  const past = isPastSlot("2026-03-29", "01:30", "Europe/Berlin", now);

  // then
  expect(past).toBe(false);
});

it("given a slot crossing a spring-forward gap, when building its booking interval, then its duration stays unchanged", () => {
  // when
  const slot = bookingTimeSlot("2026-03-29", "01:30", "Europe/Berlin", 30);

  // then
  expect(Date.parse(slot.endsAt) - Date.parse(slot.startsAt)).toBe(30 * 60_000);
  expect(localTimeIn(slot.endsAt, "Europe/Berlin")).toBe("29/03/2026, 03:00");
});

it("given a nonexistent wall-clock time, when validating it, then it is rejected", () => {
  // when
  const valid = isValidZonedDateTime("2026-03-29", "02:30", "Europe/Berlin");

  // then
  expect(valid).toBe(false);
});

it("given a duplicated fall-back time, when resolving its zoned instant, then the earlier occurrence is selected", () => {
  // when
  const instant = zonedDateTime("2026-10-25", "02:30", "Europe/Berlin");

  // then
  expect(instant).toBe("2026-10-25T02:30:00+02:00");
});
