import { describe, expect, it } from "vitest";
import { allTime, matchingChoice, periodFromAddress, previousCalendarYear, rollingPeriod } from "./period";

describe("statistics periods", () => {
  it("given today, when choosing seven days, then the period ends today and holds seven days", () => {
    // when
    const period = rollingPeriod("7d", "2026-09-26");

    // then
    expect(period).toEqual({ from: "2026-09-20", to: "2026-09-26" });
  });

  it("given the last day of March, when choosing one month, then February's missing days do not push the start into March", () => {
    // when
    const period = rollingPeriod("1m", "2026-03-31");

    // then
    expect(period).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });

  it("given the last day of May, when choosing three months, then the period starts on the first of March", () => {
    // when
    const period = rollingPeriod("3m", "2026-05-31");

    // then
    expect(period).toEqual({ from: "2026-03-01", to: "2026-05-31" });
  });

  it("given a leap day, when choosing twelve months, then the year before ends on the last of February", () => {
    // when
    const period = rollingPeriod("12m", "2028-02-29");

    // then
    expect(period).toEqual({ from: "2027-03-01", to: "2028-02-29" });
  });

  it("given a day in the middle of a month, when choosing six months, then the period starts the day after the same date", () => {
    // when
    const period = rollingPeriod("6m", "2026-09-26");

    // then
    expect(period).toEqual({ from: "2026-03-27", to: "2026-09-26" });
  });

  it("given a day in January, when choosing one month, then the start falls in December of the year before", () => {
    // when
    const period = rollingPeriod("1m", "2027-01-15");

    // then
    expect(period).toEqual({ from: "2026-12-16", to: "2027-01-15" });
  });

  it("given today, when choosing the previous calendar year, then it runs from its first to its last day", () => {
    // when
    const period = previousCalendarYear("2026-09-26");

    // then
    expect(period).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("given a first booking in the past, when choosing all time, then the period runs from it to today", () => {
    // when
    const period = allTime({ firstBookingOn: "2024-04-12", today: "2026-09-26", timeZone: "Europe/Berlin" });

    // then
    expect(period).toEqual({ from: "2024-04-12", to: "2026-09-26" });
  });

  it("given only bookings still to come, when choosing all time, then the period is today alone rather than one ending before it starts", () => {
    // when
    const period = allTime({ firstBookingOn: "2026-10-03", today: "2026-09-26", timeZone: "Europe/Berlin" });

    // then
    expect(period).toEqual({ from: "2026-09-26", to: "2026-09-26" });
  });

  it("given no booking at all, when choosing all time, then there is no period to read", () => {
    // when
    const period = allTime({ firstBookingOn: null, today: "2026-09-26", timeZone: "Europe/Berlin" });

    // then
    expect(period).toBeUndefined();
  });

  it("given a period that equals a quick choice, when matching it, then that choice is named", () => {
    // given
    const range = { firstBookingOn: "2024-04-12", today: "2026-09-26", timeZone: "Europe/Berlin" };

    // when / then
    expect(matchingChoice({ from: "2026-08-27", to: "2026-09-26" }, range)).toBe("1m");
    expect(matchingChoice({ from: "2025-01-01", to: "2025-12-31" }, range)).toBe("previousYear");
    expect(matchingChoice({ from: "2024-04-12", to: "2026-09-26" }, range)).toBe("all");
    expect(matchingChoice({ from: "2026-08-28", to: "2026-09-26" }, range)).toBeUndefined();
    expect(matchingChoice({ from: "2026-08-27", to: "2026-09-26" }, undefined)).toBeUndefined();
  });

  it("given an address with a valid period, when reading it, then both dates are taken", () => {
    // when
    const period = periodFromAddress(new URLSearchParams("from=2026-01-01&to=2026-03-31"));

    // then
    expect(period).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });

  it("given an address whose dates are malformed, reversed, impossible or half given, when reading it, then no period is taken", () => {
    // when / then
    for (const query of ["from=2026-01-01", "to=2026-01-01", "from=2026-1-1&to=2026-03-31",
      "from=2026-04-01&to=2026-03-31", "from=2026-02-30&to=2026-03-31", "from=<b>&to=2026-03-31"]) {
      expect(periodFromAddress(new URLSearchParams(query)), query).toBeUndefined();
    }
  });
});
