import { describe, expect, it } from "vitest";
import { leavesBookingHours } from "./bookingHours";

const hours = { earliestStart: "09:00:00", latestEnd: "20:00:00" };

describe("leavesBookingHours", () => {
  it("given a slot that fills the window to its end, when checking it, then it stays inside", () => {
    // when
    const leaves = leavesBookingHours("19:30", 30, hours);

    // then
    expect(leaves, "both edges of the window belong to it").toBe(false);
  });

  it("given a slot that runs past the end, when checking it, then it leaves the window", () => {
    // when
    const leaves = leavesBookingHours("19:45", 30, hours);

    // then
    expect(leaves).toBe(true);
  });

  it("given a slot that starts before the window, when checking it, then it leaves the window", () => {
    // when
    const leaves = leavesBookingHours("08:30", 30, hours);

    // then
    expect(leaves).toBe(true);
  });
});
