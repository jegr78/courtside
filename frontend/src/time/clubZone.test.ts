import { expect, it } from "vitest";
import { isPastSlot, zonedDateTime } from "./clubZone";

const localTimeIn = (isoInstant: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  }).format(new Date(isoInstant));

it("resolves a slot before a spring-forward transition to that wall-clock time", () => {
  expect(localTimeIn(zonedDateTime("2026-03-29", "01:30", "Europe/Berlin"), "Europe/Berlin"))
    .toBe("29/03/2026, 01:30");
});

it("resolves a slot after a fall-back transition to that wall-clock time", () => {
  expect(localTimeIn(zonedDateTime("2026-10-25", "01:30", "Europe/Berlin"), "Europe/Berlin"))
    .toBe("25/10/2026, 01:30");
});

it("resolves an ordinary slot to that wall-clock time", () => {
  expect(localTimeIn(zonedDateTime("2026-05-12", "18:00", "Europe/Berlin"), "Europe/Berlin"))
    .toBe("12/05/2026, 18:00");
});

it("resolves a slot in a zone with a half-hour transition", () => {
  expect(localTimeIn(zonedDateTime("2026-10-04", "02:30", "Australia/Lord_Howe"), "Australia/Lord_Howe"))
    .toBe("04/10/2026, 02:30");
});

it("resolves a slot in a zone ahead of UTC", () => {
  expect(localTimeIn(zonedDateTime("2026-09-27", "01:30", "Pacific/Auckland"), "Pacific/Auckland"))
    .toBe("27/09/2026, 01:30");
});

it("treats a slot before now as past", () => {
  expect(isPastSlot("2026-05-12", "17:00", "Europe/Berlin", new Date("2026-05-12T16:00:00Z")))
    .toBe(true);
});

it("treats a slot after now as not past", () => {
  expect(isPastSlot("2026-05-12", "19:00", "Europe/Berlin", new Date("2026-05-12T16:00:00Z")))
    .toBe(false);
});
