import { describe, expect, it } from "vitest";
import { byDay } from "./byDay";

describe("byDay", () => {
  it("given entries on two days of a week, when they are sorted, then each lands on its club day only", () => {
    // given
    const dates = ["2026-08-10", "2026-08-11", "2026-08-12"];
    const monday = { startsAt: "2026-08-10T18:00:00+02:00", endsAt: "2026-08-10T19:00:00+02:00" };
    const wednesday = { startsAt: "2026-08-12T08:00:00+02:00", endsAt: "2026-08-12T09:00:00+02:00" };

    // when
    const days = byDay(dates, [monday, wednesday], "Europe/Berlin");

    // then
    expect(days.get("2026-08-10")).toEqual([monday]);
    expect(days.get("2026-08-11"), "a day without an entry is empty, not missing").toEqual([]);
    expect(days.get("2026-08-12")).toEqual([wednesday]);
  });

  it("given an entry across midnight in the club's zone, when it is sorted, then both days hold it", () => {
    // given
    const late = { startsAt: "2026-08-10T23:30:00+02:00", endsAt: "2026-08-11T00:30:00+02:00" };

    // when
    const days = byDay(["2026-08-10", "2026-08-11"], [late], "Europe/Berlin");

    // then
    expect(days.get("2026-08-10")).toEqual([late]);
    expect(days.get("2026-08-11"), "the day it ends on holds it as a per-day read did").toEqual([late]);
  });

  it("given an entry ending exactly at midnight, when it is sorted, then the next day does not hold it", () => {
    // given
    const evening = { startsAt: "2026-08-10T23:00:00+02:00", endsAt: "2026-08-11T00:00:00+02:00" };

    // when
    const days = byDay(["2026-08-10", "2026-08-11"], [evening], "Europe/Berlin");

    // then
    expect(days.get("2026-08-11"), "an end at midnight is exclusive").toEqual([]);
  });
});
