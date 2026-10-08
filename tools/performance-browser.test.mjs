import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { prepareBrowserBooking } from "../performance/browser-journey.js";
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

function browserLauncherFixture(context) {
  const root = mkdtempSync(join(tmpdir(), "browser-launcher-"));
  const profiles = [];
  const native = join(root, "native-chromium");
  const launcher = join(root, "launcher");
  const legacy = join(root, "legacy-nssdb");
  const source = readFileSync(fileURLToPath(new URL("../performance/chromium-headless.sh", import.meta.url)), "utf8");
  writeFileSync(native, '#!/bin/sh\nprintf "%s\\n" "$XDG_DATA_HOME" "$HOME" "$@"\n', { mode: 0o700 });
  writeFileSync(launcher, source.replace("exec /usr/bin/chromium", `exec "${native}"`)
    .replaceAll("/tmp/.pki/nssdb", legacy)
    .replaceAll("/tmp/k6browser-data-", root + "/k6browser-data-"), { mode: 0o700 });
  context.after(() => {
    for (const profile of profiles) rmSync(profile, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });
  const profilePath = () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const profile = join(root, `k6browser-data-${randomInt(0, 2 ** 32)}`);
      try {
        mkdirSync(profile, { mode: 0o700 });
        profiles.push(profile);
        return profile;
      } catch (failure) {
        if (failure.code !== "EEXIST") throw failure;
      }
    }
    throw new Error("No private browser profile available");
  };
  const run = (args, environment = {}) => spawnSync("/bin/sh", [launcher, ...args], {
    env: { ...process.env, HOME: "/tmp", ...environment }, encoding: "utf8", timeout: 1000
  });
  return { root, legacy, profiles, profilePath, run };
}

const browserFlags = ["--headless", "--disable-features=ExistingA,ExistingB", "--ignore-certificate-errors-spki-list=verified-pin"];
const posixOnly = { skip: process.platform === "win32" };

test("given two private k6 profiles, when launching Chromium, then preserve TLS and separate their XDG data directories", posixOnly, context => {
  // given
  const fixture = browserLauncherFixture(context);
  const profiles = [fixture.profilePath(), fixture.profilePath()];
  // when
  const results = profiles.map(profile => fixture.run([...browserFlags, `--user-data-dir=${profile}`]));
  // then
  for (let index = 0; index < results.length; index++) {
    const profile = profiles[index];
    assert.equal(results[index].status, 0, results[index].stderr);
    assert.deepEqual(results[index].stdout.trim().split("\n"), [profile + "/courtside-data", "/tmp",
      ...browserFlags, `--user-data-dir=${profile}`,
      "--disable-features=ExistingA,ExistingB,WebUIOmniboxPopup,WebUIOmniboxAimPopup"]);
    assert.equal(statSync(profile + "/courtside-data").mode & 0o777, 0o700);
  }
  assert.notEqual(profiles[0], profiles[1]);
});

test("given missing or duplicate feature switches, when launching Chromium, then reject before creating runtime data", posixOnly, context => {
  // given
  const fixture = browserLauncherFixture(context);
  const profile = fixture.profilePath();
  // when
  const missing = fixture.run(["--headless", `--user-data-dir=${profile}`]);
  const duplicate = fixture.run([...browserFlags, "--disable-features=Other", `--user-data-dir=${profile}`]);
  // then
  assert.equal(missing.status, 64);
  assert.equal(duplicate.status, 64);
  assert.equal(missing.stdout + duplicate.stdout, "");
  assert.equal(existsSync(profile + "/courtside-data"), false);
});

test("given a missing or foreign profile path, when launching Chromium, then refuse to use another data directory", posixOnly, context => {
  // given
  const fixture = browserLauncherFixture(context);
  // when
  const results = [fixture.run(browserFlags),
    fixture.run([...browserFlags, `--user-data-dir=${fixture.root}`]),
    fixture.run([...browserFlags, "--user-data-dir=/tmp/k6browser-data-123/../../foreign"])];
  // then
  for (const result of results) {
    assert.equal(result.status, 64);
    assert.equal(result.stdout, "");
  }
  assert.equal(existsSync(fixture.root + "/courtside-data"), false);
});

test("given duplicated or symlinked profiles, when launching Chromium, then reject before following their data paths", posixOnly, context => {
  // given
  const fixture = browserLauncherFixture(context);
  const profile = fixture.profilePath();
  const link = fixture.profilePath();
  rmdirSync(link);
  symlinkSync(fixture.root, link);
  // when
  const duplicate = fixture.run([...browserFlags, `--user-data-dir=${profile}`, `--user-data-dir=${profile}`]);
  const symlink = fixture.run([...browserFlags, `--user-data-dir=${link}`]);
  // then
  assert.equal(duplicate.status, 64);
  assert.equal(symlink.status, 64);
  assert.equal(existsSync(profile + "/courtside-data"), false);
  assert.equal(existsSync(fixture.root + "/courtside-data"), false);
});

test("given retained browser runtime data, when launching again, then preserve the data and refuse reuse", posixOnly, context => {
  // given
  const fixture = browserLauncherFixture(context);
  const profile = fixture.profilePath();
  mkdirSync(profile + "/courtside-data", { mode: 0o700 });
  writeFileSync(profile + "/courtside-data/marker", "retained");
  // when
  const result = fixture.run([...browserFlags, `--user-data-dir=${profile}`]);
  // then
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(readFileSync(profile + "/courtside-data/marker", "utf8"), "retained");
});

test("given a legacy trust directory or broken link, when launching Chromium, then refuse shared certificate state", posixOnly, context => {
  // given
  const fixture = browserLauncherFixture(context);
  const profile = fixture.profilePath();
  mkdirSync(fixture.legacy, { mode: 0o700 });
  // when
  const directory = fixture.run([...browserFlags, `--user-data-dir=${profile}`]);
  rmdirSync(fixture.legacy);
  symlinkSync(fixture.root + "/missing", fixture.legacy);
  const link = fixture.run([...browserFlags, `--user-data-dir=${profile}`]);
  // then
  assert.equal(directory.status, 64);
  assert.equal(link.status, 64);
  assert.equal(existsSync(profile + "/courtside-data"), false);
});

test("given command syntax inside an argument, when launching Chromium, then pass it literally without executing it", posixOnly, context => {
  // given
  const fixture = browserLauncherFixture(context);
  const profile = fixture.profilePath();
  const marker = fixture.root + "/executed";
  const argument = `--label=$(touch ${marker})`;
  // when
  const result = fixture.run([...browserFlags, argument, `--user-data-dir=${profile}`]);
  // then
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.split("\n").includes(argument));
  assert.equal(existsSync(marker), false);
});

test("given a read-only launcher source, when the browser entrypoint starts, then copy it privately and forward the original k6 arguments", posixOnly, context => {
  // given
  const root = mkdtempSync(join(tmpdir(), "browser-entrypoint-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const runtime = join(root, "runtime");
  const native = join(root, "k6");
  const entrypoint = join(root, "entrypoint");
  const launcher = readFileSync(fileURLToPath(new URL("../performance/chromium-headless.sh", import.meta.url)));
  writeFileSync(source, launcher, { mode: 0o400 });
  writeFileSync(native, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
  writeFileSync(entrypoint, readFileSync(fileURLToPath(new URL("../performance/browser-entrypoint.sh", import.meta.url)), "utf8")
    .replaceAll("/tmp/courtside-browser-runtime", runtime)
    .replace("/scripts/chromium-headless.sh", source)
    .replace("exec /usr/bin/k6", `exec "${native}"`), { mode: 0o700 });
  // when
  const result = spawnSync("/bin/sh", [entrypoint, "run", "--tag", "testid=original", "/scripts/browser.js"],
    { encoding: "utf8", timeout: 1000 });
  // then
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), ["run", "--tag", "testid=original", "/scripts/browser.js"]);
  assert.equal(statSync(runtime).mode & 0o777, 0o700);
  assert.equal(statSync(runtime + "/chromium").mode & 0o777, 0o700);
  assert.deepEqual(readFileSync(runtime + "/chromium"), launcher);
  assert.deepEqual(readFileSync(source), launcher);
  assert.equal(statSync(source).mode & 0o777, 0o400);
  const repeated = spawnSync("/bin/sh", [entrypoint, "run"], { encoding: "utf8", timeout: 1000 });
  assert.notEqual(repeated.status, 0);
  assert.equal(repeated.stdout, "");
});

test("given an existing nonnumeric profile, when launching Chromium, then refuse a directory not generated by k6", posixOnly, context => {
  // given
  const fixture = browserLauncherFixture(context);
  const original = fixture.profilePath();
  const profile = original + "invalid";
  renameSync(original, profile);
  fixture.profiles[fixture.profiles.indexOf(original)] = profile;
  // when
  const result = fixture.run([...browserFlags, `--user-data-dir=${profile}`]);
  // then
  assert.equal(result.status, 64);
  assert.equal(result.stdout, "");
  assert.equal(existsSync(profile + "/courtside-data"), false);
});

test("given another browser home, when launching Chromium, then refuse an unverified legacy trust location", posixOnly, context => {
  // given
  const fixture = browserLauncherFixture(context);
  const profile = fixture.profilePath();
  // when
  const result = fixture.run([...browserFlags, `--user-data-dir=${profile}`], { HOME: "/different-browser-home" });
  // then
  assert.equal(result.status, 64);
  assert.equal(result.stdout, "");
  assert.equal(existsSync(profile + "/courtside-data"), false);
});
