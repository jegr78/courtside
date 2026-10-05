import assert from "node:assert/strict";
import { test } from "node:test";
import { resourceDatePlan } from "./security-resource-dates.mjs";

const state = timeZone => ({ tables: { club_config: { rows: [{ time_zone: timeZone }] } } });

test("given the native club zone across autumn DST, when freezing the race slots, then series wall time identifies the same actual UTC slot", () => {
  // given
  const clocks = [Date.parse("2026-10-05T23:59:59.999Z"), Date.parse("2026-10-22T23:59:59.999Z")];
  // when
  const plans = clocks.map(clock => resourceDatePlan(state("Europe/Berlin"), clock));
  // then
  assert.equal(plans[0].slots[6].startTime, "18:00:00");
  assert.equal(plans[1].slots[6].startTime, "17:00:00");
  assert.equal(plans[0].slots[6].startsAt, "2026-10-11T16:00:00.000Z");
  assert.equal(plans[1].slots[6].startsAt, "2026-10-28T16:00:00.000Z");
  assert.deepEqual(plans.map(plan => plan.clock), clocks);
});

test("given a club beyond the UTC calendar date, when constructing series inputs, then use its actual local date and weekday", () => {
  // given
  const clock = Date.parse("2026-12-28T23:59:59.999Z");
  // when
  const plan = resourceDatePlan(state("Pacific/Kiritimati"), clock);
  // then
  assert.equal(plan.slots[6].startsAt, "2027-01-03T16:00:00.000Z");
  assert.equal(plan.slots[6].startsOn, "2027-01-04");
  assert.equal(plan.slots[6].startTime, "06:00:00");
  assert.equal(plan.slots[6].weekday, "MONDAY");
  assert.equal(plan.seriesStartsOn, "2027-01-28");
});

test("given an incomplete clock or club configuration, when planning slots, then refuse rather than invent an assessment zone", () => {
  // given
  const invalid = [{ tables: {} }, state("Unknown/Zone"), { tables: { club_config: { rows: [] } } },
    { tables: { club_config: { rows: [{ time_zone: "UTC" }, { time_zone: "UTC" }] } } }];
  // when / then
  for (const snapshot of invalid) assert.throws(() => resourceDatePlan(snapshot, Date.now()), /date plan/);
  for (const clock of [NaN, Infinity, -1, 0.5, "2026-10-05"])
    assert.throws(() => resourceDatePlan(state("UTC"), clock), /date plan/);
});
