import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/schema.mjs";
import { restoreCommand, sameServeConfiguration } from "./outage.mjs";
import { judge } from "./verdicts.mjs";

const config = loadConfig();
const port = Number(process.env.SAFARIDRIVER_PORT ?? 4724);
const out = process.env.DEVICE_RUN_DIR
  ?? fileURLToPath(new URL(`../../build/acceptance-device/${new Date().toISOString().replace(/[:.]/g, "-")}`, import.meta.url));
const outageHost = process.env.DEVICE_OUTAGE_HOST;
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
const PLAN_READY = "return !!document.querySelector('[data-testid=day-plan-table]') && !document.querySelector('p[role=status]:not([data-testid])');";
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
mkdirSync(out, { recursive: true });

async function call(method, path, body) {
  const response = await fetch(`http://localhost:${port}${path}`, {
    method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(90_000)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${payload.value?.error} ${payload.value?.message}`);
  return payload.value;
}

async function startDriver() {
  const driver = spawn("/usr/bin/safaridriver", ["-p", String(port)], { stdio: "ignore" });
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await call("GET", "/status")).ready !== undefined) return driver; } catch { await pause(200); }
  }
  driver.kill();
  throw new Error(`safaridriver did not answer on port ${port}`);
}

async function openSession() {
  const capabilities = { alwaysMatch: { platformName: "iOS", "safari:deviceType": "iPhone", "safari:diagnose": process.env.DEVICE_DIAGNOSE === "1" } };
  for (let attempt = 0; ; attempt++) {
    try { return (await call("POST", "/session", { capabilities })).sessionId; } catch (error) {
      if (!/could not be used|already paired/.test(error.message) || attempt === 60) throw error;
      if (attempt === 0) console.log("unlock the iPhone, keep its screen on and end any automation session Safari still shows");
      await pause(2_000);
    }
  }
}

function browser(session) {
  const base = `/session/${session}`;
  const exec = (script, ...args) => call("POST", `${base}/execute/sync`, { script, args });
  const shown = "return [...document.querySelectorAll(arguments[0])].find((e) => e.getClientRects().length > 0) ?? null;";
  const find = async (css) => {
    const element = await exec(shown, css);
    if (!element) throw new Error(`no visible ${css}`);
    return { [ELEMENT]: Object.values(element)[0] };
  };
  const until = async (description, script, ...args) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const value = await exec(script, ...args);
      if (value) return value;
      await pause(250);
    }
    throw new Error(`waited 30 s for ${description}`);
  };
  return {
    exec, until,
    visible: (css) => until(`${css} to be visible`, shown.replace("?? null", "!== undefined"), css),
    go: (path) => call("POST", `${base}/url`, { url: `${config.baseUrl}${path}` }),
    screenshot: async (name) => {
      writeFileSync(join(out, `${name}.png`), Buffer.from(await call("GET", `${base}/screenshot`), "base64"));
      return `${name}.png`;
    },
    // Safari on iOS ignores WebDriver element click and send keys, so the page receives script events instead.
    click: async (css) => exec("arguments[0].click();", await find(css)),
    type: async (css, text) => exec(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(arguments[0], arguments[1]);
      arguments[0].dispatchEvent(new Event("input", { bubbles: true }));`, await find(css), text)
  };
}

async function signIn(b) {
  await b.go("/");
  await b.exec("localStorage.setItem('courtside.theme', 'dark'); localStorage.setItem('courtside.locale', 'de');");
  await b.go("/");
  await b.visible("[data-testid=court-plan-view]");
  if (await b.exec("return [...document.querySelectorAll('[data-testid=sign-in-link]')].some((e) => e.getClientRects().length > 0);")) {
    await b.click("[data-testid=sign-in-link]");
    await b.visible("[data-testid=login-view]");
    await b.type("[data-testid=username]", config.personas.memberA);
    await b.type("[data-testid=password]", config.password);
    await b.click("[data-testid=login-submit]");
    await b.until("the member session", "return !document.querySelector('[data-testid=sign-in-link]') && !!document.querySelector('[data-testid=court-plan-view]');");
  }
  await b.until("the plan", PLAN_READY);
}

const INHERITED_TEXT = `const pick = (label, element) => element ? { label, color: getComputedStyle(element).color, background: getComputedStyle(document.body).backgroundColor } : { label, missing: true };
  return [
    pick("theme label", document.querySelector('label[for=theme-preference]')),
    pick("first weekday", document.querySelector('[data-testid^=day-selector-]')),
    pick("plan header cell", document.querySelector('[data-testid=day-plan-table] th')),
    pick("tab bar link", document.querySelector('[data-testid=my-messages-link]'))
  ];`;

async function themeSwitch(b) {
  await b.exec("window.scrollTo(0, 0);");
  await b.click("[data-testid=preferences-menu]");
  await b.visible("#theme-preference");
  const shots = [await b.screenshot("theme-0-dark")];
  await b.exec(`const select = document.querySelector('#theme-preference');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'light');
    select.dispatchEvent(new Event('change', { bubbles: true }));`);
  shots.push(await b.screenshot("theme-1-light-at-once"));
  await pause(1_000);
  shots.push(await b.screenshot("theme-2-light-after-1s"));
  const afterOneSecond = await b.exec(INHERITED_TEXT);
  await pause(2_000);
  shots.push(await b.screenshot("theme-3-light-after-3s"));
  await b.click("[data-testid=preferences-menu]");
  return { check: "theme-switch", afterOneSecond, shots };
}

async function selectHeights(b) {
  const slot = "button[data-testid=free-slot][data-state=free]";
  await b.go("/");
  await b.until("the plan", PLAN_READY);
  await b.until("a free slot", "return !!document.querySelector(arguments[0]);", slot);
  await b.exec("document.querySelector(arguments[0]).scrollIntoView({ block: 'center' });", slot);
  await b.click(slot);
  await b.visible("[data-testid=booking-dialog]");
  const fields = await b.exec(`return ['booking-duration', 'booking-card', 'member-search'].map((testId) => {
    const element = document.querySelector('[data-testid=' + testId + ']');
    return element ? { testId, tag: element.localName, height: Math.round(element.getBoundingClientRect().height) } : { testId, missing: true };
  });`);
  const shots = [await b.screenshot("select-heights-booking-dialog")];
  await b.click("[data-testid=booking-close]");
  await b.until("the dialog to close", "return !document.querySelector('[data-testid=booking-dialog]');");
  return { check: "select-heights", fields, shots };
}

async function savedMessage(b) {
  const choice = "[data-testid=message-choice-BOOKING_REMINDER]";
  await b.click("[data-testid=my-messages-link]");
  await b.visible("[data-testid=my-messages-view]");
  await b.visible(choice);
  const before = await b.exec("return document.querySelector(arguments[0]).checked;", choice);
  try {
    await b.click(choice);
    await b.exec("document.querySelector('[data-testid=my-messages-save]').scrollIntoView({ block: 'center' });");
    await b.click("[data-testid=my-messages-save]");
    await b.visible("[data-testid=my-messages-saved]");
    const placement = await b.exec(`const box = document.querySelector('[data-testid=my-messages-saved]').getBoundingClientRect();
      return { top: Math.round(box.top), bottom: Math.round(box.bottom), viewport: innerHeight, inView: box.bottom > 0 && box.top < innerHeight };`);
    return { check: "saved-message", placement, shots: [await b.screenshot("saved-message")] };
  } finally {
    if (await b.exec("return document.querySelector(arguments[0])?.checked !== arguments[1];", choice, before)) {
      await b.click(choice);
      await b.click("[data-testid=my-messages-save]");
      await b.until("the choice to be restored", "return document.querySelector(arguments[0]).checked === arguments[1];", choice, before);
    }
  }
}

async function serviceWorker(b) {
  await b.exec("return navigator.serviceWorker.ready.then(() => true);");
  await b.go("/");
  await b.until("the plan", PLAN_READY);
  return { check: "service-worker", controlled: await b.exec("return !!navigator.serviceWorker.controller;") };
}

const onBox = (...command) => execFileSync("ssh", ["--", outageHost, "sudo", "-n", ...command], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const serveStatus = () => JSON.parse(onBox("tailscale", "serve", "status", "--json"));
let takenDown;

// Funnel terminates TLS inside tailscaled, so a firewall never sees the iPhone; only removing the handler cuts it off.
function setServerUp(up) {
  if (!up) {
    const before = serveStatus();
    const restore = restoreCommand(before);
    onBox("systemd-run", "--on-active=300", `/usr/bin/${restore[0]}`, ...restore.slice(1));
    onBox(restore[0], restore[1], "--https=443", "off");
    takenDown = { before, restore };
  } else if (takenDown) {
    onBox(...takenDown.restore);
    if (!sameServeConfiguration(takenDown.before, serveStatus())) throw new Error("the serve configuration differs from the one taken down");
    takenDown = undefined;
  }
}

async function reachable(b, wanted, seconds = 30) {
  setServerUp(wanted);
  const deadline = Date.now() + seconds * 1_000;
  while (Date.now() < deadline) {
    if (await b.exec("return fetch('/api/session', { cache: 'no-store', signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false);") === wanted) return;
    await pause(1_000);
  }
  throw new Error(`the server stayed ${wanted ? "unreachable" : "reachable"} for the iPhone for ${seconds} s`);
}

async function outage(b) {
  try { await reachable(b, false, 15); } finally { await reachable(b, true); }
  return { check: "outage" };
}

async function cancel(b, id) {
  return b.exec(`return (async (id) => {
    const token = decodeURIComponent(document.cookie.split('; ').find((c) => c.includes('XSRF-TOKEN='))?.split('=')[1] ?? '');
    const answer = await fetch('/api/bookings/' + id, { method: 'DELETE', headers: { 'X-XSRF-TOKEN': token } });
    for (let cursor = '', page = 0; page < 50; page++) {
      const cancelled = await fetch('/api/my/bookings?view=CANCELLED&limit=50' + (cursor && '&cursor=' + cursor), { cache: 'no-store' }).then((r) => r.json());
      if (cancelled.items.some((item) => item.id === id)) return answer.status + ' verified';
      if (!cancelled.nextCursor) break;
      cursor = cancelled.nextCursor;
    }
    return answer.status + ' not among cancelled bookings';
  })(arguments[0]);`, id);
}

const OFFLINE_VIEW = `return {
  listed: !!document.querySelector('[data-testid=booking-' + arguments[0] + ']'),
  offlineStatus: !!document.querySelector('[data-testid=offline-status]'),
  asOf: document.querySelector('[data-testid=bookings-offline-as-of]')?.textContent ?? null,
  text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 240)
};`;

const pending = process.env.DEVICE_CANCEL?.split(",").filter(Boolean) ?? [];

async function bookTwoDaysAhead(b) {
  await b.go("/");
  await b.until("the plan", PLAN_READY);
  const zone = await b.exec("return fetch('/api/my/bookings?view=HISTORY&limit=1', { cache: 'no-store' }).then((r) => r.json()).then((page) => page.timeZone);");
  const day = await b.exec("return new Date(Date.now() + 2 * 86_400_000).toLocaleDateString('sv', { timeZone: arguments[0] });", zone);
  const selector = `[data-testid=day-selector-${day}]`;
  for (let hop = 0; hop < 2 && !(await b.exec("return [...document.querySelectorAll(arguments[0])].some((e) => e.getClientRects().length > 0);", selector)); hop++) {
    await b.click("[data-testid=mobile-week-next], [data-testid=week-next]");
    await pause(1_000);
  }
  await b.click(selector);
  await b.until(`${day} to be selected`, "return document.querySelector(arguments[0])?.getAttribute('aria-pressed') === 'true';", selector);
  await b.exec(`window.__created = null;
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      if (String(input).endsWith('/api/bookings') && init?.method === 'POST') window.__created = { status: response.status, body: await response.clone().json().catch(() => null) };
      return response;
    };`);
  const free = `button[data-testid=free-slot][data-state=free][data-date="${day}"]`;
  await b.visible(free);
  await b.click(free);
  await b.visible("[data-testid=booking-dialog]");
  await b.click("[data-testid=booking-more-summary]");
  await b.visible("[data-testid=guest-name]");
  await b.type("[data-testid=guest-name]", "Richard Roe");
  await b.click("[data-testid=booking-submit]");
  const created = await b.until("the booking answer", "return window.__created;");
  if (!created.body?.id) throw new Error(`the booking was refused: ${JSON.stringify(created)}`);
  pending.push(created.body.id);
  return created.body.id;
}

async function offlineBookings(b) {
  const id = await bookTwoDaysAhead(b);
  const result = { check: "offline-bookings", bookingId: id, shots: [], timeline: [] };
  try {
    await b.click("[data-testid=my-bookings-link]");
    await b.visible(`[data-testid=booking-${id}]`);
    result.shots.push(await b.screenshot("offline-0-online"));
    await reachable(b, false);
    await b.exec("location.assign('/my-bookings');");
    for (let second = 1; second <= 90; second++) {
      await pause(1_000);
      const view = await b.exec(OFFLINE_VIEW, id).catch((error) => ({ error: error.message }));
      if (second % 10 === 0 || view.listed) {
        result.timeline.push({ second, ...view });
        result.shots.push(await b.screenshot(`offline-1-after-${second}s`).catch(() => null));
      }
      if (view.listed) {
        result.offline = { ...view, within: second };
        break;
      }
    }
    if (result.offline) {
      await b.click("[data-testid=court-plan-link]");
      result.plan = await b.until("the plan's offline notice", `const notice = document.querySelector('[data-testid=court-plan-offline]');
        return !!document.querySelector('[data-testid=court-plan-view]') && !!notice && { notice: notice.textContent };`).catch(() => null);
      result.shots.push(await b.screenshot("offline-2-plan"));
    }
  } catch (error) {
    result.error = error.message;
  }
  try {
    await reachable(b, true);
    result.cancelled = await cancel(b, id);
    if (result.cancelled.endsWith("verified")) pending.splice(pending.indexOf(id), 1);
  } catch (error) {
    result.error = [result.error, `restoring: ${error.message}`].filter(Boolean).join("; ");
  }
  return result;
}

const CHECKS = { "theme-switch": themeSwitch, "select-heights": selectHeights, "saved-message": savedMessage,
  "service-worker": serviceWorker, "outage": outage, "offline-bookings": offlineBookings };
const NEEDS_OUTAGE = new Set(["outage", "offline-bookings"]);

const driver = await startDriver();
const result = { baseUrl: config.baseUrl, startedAt: new Date().toISOString(), checks: [] };
let session;
try {
  session = await openSession();
  const b = browser(session);
  await signIn(b).catch(async (error) => { await b.screenshot("sign-in-error").catch(() => null); throw error; });
  result.userAgent = await b.exec("return navigator.userAgent;");
  const only = process.env.DEVICE_CHECKS?.split(",");
  for (const [name, check] of Object.entries(CHECKS).filter(([name]) => !only || only.includes(name))) {
    if (NEEDS_OUTAGE.has(name) && !outageHost) {
      result.checks.push({ check: name, skipped: "DEVICE_OUTAGE_HOST is not set" });
    } else if (name === "offline-bookings" && result.checks.some((c) => c.check === "outage" && c.error)) {
      result.checks.push({ check: name, skipped: "the outage did not take effect" });
    } else {
      try { result.checks.push(await check(b)); } catch (error) {
        result.checks.push({ check: name, error: error.message, shot: await b.screenshot(`${name}-error`).catch(() => null) });
      }
    }
  }
} catch (error) {
  result.error = error.message;
} finally {
  const attempt = async (step, action) => { try { await action(); } catch (error) { result.cleanupErrors = { ...result.cleanupErrors, [step]: error.message }; } };
  await attempt("serve configuration", () => { if (takenDown) setServerUp(true); });
  for (const id of session ? [...pending] : []) await attempt(`booking ${id}`, async () => { result.cleanup = { ...result.cleanup, [id]: await cancel(browser(session), id) }; });
  for (const check of result.checks) Object.assign(check, judge(check));
  writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2));
  if (session) await call("DELETE", `/session/${session}`).catch(() => undefined);
  driver.kill();
  if (result.error) console.log(`error   ${result.error}`);
  for (const [step, message] of Object.entries(result.cleanupErrors ?? {})) console.log(`cleanup failed, ${step}: ${message}`);
  for (const check of result.checks) console.log(`${check.verdict.padEnd(7)} ${check.check}: ${check.reason}`);
  for (const [id, state] of Object.entries(result.cleanup ?? {})) console.log(`cleanup ${id}: ${state}`);
  console.log(`results in ${out}`);
}
process.exitCode = !result.error && !result.cleanupErrors && result.checks.length > 0 && result.checks.every((check) => check.verdict === "pass") ? 0 : 1;
