import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareBrowserBooking } from "../performance/browser-journey.js";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as browserDiagnostics from "../performance/browser-diagnostics.js";

const browserSource = readFileSync(new URL("../performance/browser.js", import.meta.url), "utf8");
const contract = JSON.parse(readFileSync(new URL("../performance/contract.json", import.meta.url), "utf8"));

test("given a current-week slot, when preparing a booking, then expand the guest field before entering a participant", async () => {
  // given
  const actions = [];
  const page = {
    locator(selector) {
      if (selector === 'div[data-testid="free-slot"]') return { nth: () => ({ waitFor: async () => {} }) };
      if (selector === '[data-testid="booking-card"] option') return { nth: () => ({ waitFor: async () => actions.push("cards") }) };
      if (selector === 'details[data-testid="booking-more"][open]') return { waitFor: async () => actions.push("more:open") };
      assert.match(selector, /button.*free-slot.*:not\(\[disabled\]\)/);
      return { count: async () => 1, nth: () => ({ click: async () => actions.push("slot"), waitFor: async () => {} }) };
    },
    getByTestId(id) {
      return {
        click: async () => actions.push(id),
        waitFor: async () => actions.push(`${id}:visible`),
        fill: async (value) => actions.push(`${id}:${value}`),
        inputValue: async () => "Browser Test Guest"
      };
    }
  };
  // when
  await prepareBrowserBooking(page, 1);
  // then
  assert.deepEqual(actions, ["slot", "cards", "booking-more-summary", "more:open", "guest-name:visible", "guest-name:Browser Test Guest"],
    "the dialog must have its cards before the summary is clicked, and be open before the guest is entered");
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
      waitFor: async () => {}, fill: async () => {}, inputValue: async () => "Browser Test Guest"
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
    locator: () => ({ count: async () => 1, waitFor: async () => {}, nth: () => ({ click: async () => {}, waitFor: async () => {} }) }),
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
      waitFor: async () => {}, fill: async () => {}, inputValue: async () => "Browser Test Guest" })
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
    return { count: async () => { assert.equal(eligible, true); return 1; }, nth: () => ({ click: async () => {}, waitFor: async () => {} }),
      waitFor: async () => {} };
  }, getByTestId: () => ({ click: async () => {}, waitFor: async () => {}, fill: async () => {}, inputValue: async () => "Browser Test Guest" }) };
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
      nth: () => ({ click: async () => {}, waitFor: async () => {} }), waitFor: async () => {} };
  }, getByTestId: id => ({ click: async () => { if (id === "week-next") nextWeek = true; },
    waitFor: async () => { if (id === "day-selector-2026-10-12") loaded = true; }, fill: async () => {},
    inputValue: async () => "Browser Test Guest" }) };
  // when
  await prepareBrowserBooking(page, 1);
  // then
  assert.equal(loaded, true);
});

test("given a browser that cannot open a page, when a journey starts, then the failure counts and names its step", async () => {
  // given
  const metrics = new Map();
  const logged = [];
  class Metric {
    constructor(name) { this.name = name; metrics.set(name, []); }
    add(value) { metrics.get(this.name).push(value); }
  }
  const context = {
    browser: { newPage: async () => { throw new Error("creating new page in browser context: timed out after 30s"); } },
    check: () => true, Counter: Metric, Rate: Metric, Trend: Metric,
    open: path => JSON.stringify(path.endsWith("contract.json") ? contract : { password: "test-password" }),
    console: { error: line => logged.push(line) }, Date,
    __ENV: { PERF_TARGET: "https://proxy" }, __VU: 2, __ITER: 7,
    ...browserDiagnostics, prepareBrowserBooking: async () => {}
  };
  runInNewContext(browserSource.replace(/^import .*;\n/gm, "").replace("export const options", "globalThis.options")
    .replace("export default async function", "globalThis.iteration = async function")
    .replace("export function handleSummary", "function handleSummary"), context);

  // when
  await context.iteration();

  // then
  assert.deepEqual(metrics.get("browser_journey_success"), [false],
    "a journey whose page never opened must count as a failed journey");
  assert.ok(metrics.get("browser_errors").includes(1));
  assert.ok(logged.some(line => line.startsWith("vu=2 iteration=7 Browser journey failed at open browser page after ") && line.includes(" on no page : ")),
    `the failure must name its step, got ${JSON.stringify(logged)}`);
});

test("given a summary click that leaves the details closed, when preparing a booking, then fail before entering a guest", async () => {
  // given
  let filled = false;
  const page = {
    locator(selector) {
      if (selector === 'details[data-testid="booking-more"][open]') return { waitFor: async () => {
        throw new Error("waiting for details[data-testid=booking-more][open]: timed out");
      } };
      return { count: async () => 1, waitFor: async () => {}, nth: () => ({ click: async () => {}, waitFor: async () => {} }) };
    },
    getByTestId: () => ({ click: async () => {}, waitFor: async () => {}, fill: async () => { filled = true; },
      inputValue: async () => "" })
  };
  // when / then
  await assert.rejects(prepareBrowserBooking(page, 1), /booking-more.*open/);
  assert.equal(filled, false, "a guest typed into closed details never reaches the dialog");
});

test("given a fill that does not reach the guest field, when preparing a booking, then fail instead of submitting without the guest", async () => {
  // given
  const page = {
    locator: () => ({ count: async () => 1, waitFor: async () => {}, nth: () => ({ click: async () => {}, waitFor: async () => {} }) }),
    getByTestId: () => ({ click: async () => {}, waitFor: async () => {}, fill: async () => {}, inputValue: async () => "" })
  };
  // when / then
  await assert.rejects(prepareBrowserBooking(page, 1), /guest field holds "" after entering "Browser Test Guest"/);
});

test("given a console warning on the page, when a journey runs, then the run log keeps it without counting an error", async () => {
  // given
  const metrics = new Map();
  const logged = [];
  class Metric {
    constructor(name) { this.name = name; metrics.set(name, []); }
    add(value) { metrics.get(this.name).push(value); }
  }
  const handlers = {};
  const page = {
    on: (event, handler) => { handlers[event] = handler; },
    goto: async () => {
      handlers.console({ type: () => "warning", text: () => "identity refresh: status 503" });
      throw new Error("stop after the warning");
    },
    url: () => "about:blank", close: async () => {}
  };
  const context = {
    browser: { newPage: async () => page },
    check: () => true, Counter: Metric, Rate: Metric, Trend: Metric,
    open: path => JSON.stringify(path.endsWith("contract.json") ? contract : { password: "test-password" }),
    console: { error: line => logged.push(line) }, Date,
    __ENV: { PERF_TARGET: "https://proxy" }, __VU: 3, __ITER: 4,
    ...browserDiagnostics, prepareBrowserBooking: async () => {}
  };
  runInNewContext(browserSource.replace(/^import .*;\n/gm, "").replace("export const options", "globalThis.options")
    .replace("export default async function", "globalThis.iteration = async function")
    .replace("export function handleSummary", "function handleSummary"), context);

  // when
  await context.iteration();

  // then
  assert.ok(logged.includes("vu=3 iteration=4 console warning: identity refresh: status 503"),
    `a swallowed frontend failure must reach the run log, got ${JSON.stringify(logged)}`);
  assert.deepEqual(metrics.get("browser_errors").filter(value => value > 0), [1],
    "only the failed journey counts; the warning itself is not a browser error");
});
