import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareBrowserBooking } from "../performance/browser-journey.js";

test("given a current-week slot, when preparing a booking, then expand the guest field before entering a participant", async () => {
  // given
  const actions = [];
  const page = {
    locator(selector) {
      if (selector === 'div[data-testid="free-slot"]') return { nth: () => ({ waitFor: async () => {} }) };
      assert.match(selector, /button.*free-slot.*:not\(\[disabled\]\)/);
      return { count: async () => 1, nth: () => ({ click: async () => actions.push("slot"), waitFor: async () => {} }) };
    },
    getByTestId(id) {
      return {
        click: async () => actions.push(id),
        waitFor: async () => actions.push(`${id}:visible`),
        fill: async (value) => actions.push(`${id}:${value}`)
      };
    }
  };
  // when
  await prepareBrowserBooking(page, 1);
  // then
  assert.deepEqual(actions, ["slot", "booking-more-summary", "guest-name:visible", "guest-name:Browser Test Guest"]);
});

test("given no remaining current-week slot, when preparing a booking, then use next week only as a fallback", async () => {
  // given
  const actions = [];
  let nextWeek = false;
  const page = {
    locator: selector => selector.includes("day-selector-")
      ? { count: async () => 0, nth: () => ({ getAttribute: async () => "day-selector-2026-10-05" }) }
      : { count: async () => nextWeek ? 1 : 0, nth: () => ({ click: async () => actions.push("slot"), waitFor: async () => {} }), waitFor: async () => {} },
    getByTestId: (id) => ({
      click: async () => { actions.push(id); if (id === "week-next") nextWeek = true; },
      waitFor: async () => {}, fill: async () => {}
    })
  };
  // when
  await prepareBrowserBooking(page, 2);
  // then
  assert.deepEqual(actions, ["week-next", "slot", "booking-more-summary"]);
});

test("given an inaccessible guest field, when preparing a booking, then fail rather than submit an empty participant list", async () => {
  // given
  let filled = false;
  const page = {
    locator: () => ({ count: async () => 1, nth: () => ({ click: async () => {}, waitFor: async () => {} }) }),
    getByTestId: () => ({ click: async () => {}, waitFor: async () => { throw new Error("Guest field is hidden"); },
      fill: async () => { filled = true; } })
  };
  // when / then
  await assert.rejects(prepareBrowserBooking(page, 1), /Guest field is hidden/);
  assert.equal(filled, false);
});

test("given Monday after closing and a Tuesday slot, when preparing a booking, then stay in the current week", async () => {
  // given
  const actions = [];
  let day = 0;
  const page = {
    locator(selector) {
      if (selector === 'div[data-testid="free-slot"]') return { nth: () => ({ waitFor: async () => {} }) };
      if (selector.includes('aria-pressed="true"')) return { waitFor: async () => {} };
      if (selector.includes("day-selector-")) return { count: async () => 7, nth: index => ({
        getAttribute: async name => name === "aria-pressed" ? String(index === day) : `day-selector-2026-10-${5 + index}`,
        click: async () => { day = index; actions.push(`day:${index}`); }
      }) };
      if (selector.includes("free-slot")) {
        assert.match(selector, /data-court-number="2"/);
        return { count: async () => day === 1 ? 1 : 0,
          nth: () => ({ click: async () => actions.push("slot") }) };
      }
      return { waitFor: async () => {}, nth: () => ({ waitFor: async () => {} }) };
    },
    getByTestId: id => ({ click: async () => { actions.push(id); if (id === "week-next") throw new Error("Skipped Tuesday"); },
      waitFor: async () => {}, fill: async () => {} })
  };
  // when
  await prepareBrowserBooking(page, 2);
  // then
  assert.deepEqual(actions, ["day:1", "slot", "booking-more-summary"]);
});

test("given no eligible slot in either week, when preparing a booking, then fail before opening participant controls", async () => {
  // given
  const actions = [];
  const page = { locator: () => ({ count: async () => 0, waitFor: async () => {},
    nth: () => ({ getAttribute: async () => "day-selector-2026-10-05", waitFor: async () => {} }) }),
    getByTestId: id => ({ click: async () => actions.push(id), waitFor: async () => {} }) };
  // when / then
  await assert.rejects(prepareBrowserBooking(page, 2), /No enabled booking slot/);
  assert.deepEqual(actions, ["week-next"]);
});

test("given delayed eligibility rendering, when searching slots, then wait for noninteractive placeholders to detach", async () => {
  // given
  let eligible = false;
  const page = { locator(selector) {
    if (selector === 'div[data-testid="free-slot"]') return { nth: () => ({ waitFor: async options => {
      assert.equal(options.state, "detached"); eligible = true;
    } }) };
    return { count: async () => { assert.equal(eligible, true); return 1; }, nth: () => ({ click: async () => {} }) };
  }, getByTestId: () => ({ click: async () => {}, waitFor: async () => {}, fill: async () => {} }) };
  // when
  await prepareBrowserBooking(page, 1);
  // then
  assert.equal(eligible, true);
});

test("given a delayed next-week grid, when no current-week slot remains, then wait for a date from the newly loaded week", async () => {
  // given
  let nextWeek = false;
  let loaded = false;
  const page = { locator(selector) {
    if (selector === 'div[data-testid="free-slot"]') return { nth: () => ({ waitFor: async () => {} }) };
    if (selector.includes("day-selector-")) return { count: async () => 0,
      nth: () => ({ getAttribute: async () => "day-selector-2026-10-05" }) };
    return { count: async () => { if (nextWeek) assert.equal(loaded, true); return nextWeek ? 1 : 0; },
      nth: () => ({ click: async () => {} }) };
  }, getByTestId: id => ({ click: async () => { if (id === "week-next") nextWeek = true; },
    waitFor: async () => { if (id === "day-selector-2026-10-12") loaded = true; }, fill: async () => {} }) };
  // when
  await prepareBrowserBooking(page, 1);
  // then
  assert.equal(loaded, true);
});
