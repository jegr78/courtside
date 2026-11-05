import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { computeMedianRun, filterToValidRuns } from "lighthouse/core/lib/median-run.js";
import { chromium } from "playwright-core";
import { landingFailure, lighthousePlan, reportSummary, resolvedPath } from "./pages.mjs";

const SEEDED_MEMBER_CARD = "11111111-1111-1111-1111-111111111111";
const DEBUGGING_PORT = 9222;
const origin = process.env.LIGHTHOUSE_ORIGIN;
const pin = process.env.LIGHTHOUSE_CERTIFICATE_PIN;
const output = process.env.LIGHTHOUSE_OUTPUT;
const administratorFile = process.env.LIGHTHOUSE_ADMINISTRATOR;
const { password } = JSON.parse(readFileSync(process.env.LIGHTHOUSE_STATE, "utf8"));
if (!origin || !pin || !output || !password || !administratorFile) {
  throw new Error("Lighthouse needs an origin, a certificate pin, an output, the state and the administrator file");
}

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "lighthouse-profile-")), {
  channel: "chromium", headless: true,
  args: [`--remote-debugging-port=${DEBUGGING_PORT}`, `--ignore-certificate-errors-spki-list=${pin}`]
});
const page = context.pages()[0] ?? await context.newPage();

async function call(method, path, { form, json } = {}) {
  return page.evaluate(async ({ method, path, form, json }) => {
    const token = document.cookie.split("; ").map((cookie) => cookie.split("="))
      .find(([name]) => name.endsWith("XSRF-TOKEN"))?.[1];
    const response = await fetch(path, {
      method,
      headers: { ...(token ? { "X-XSRF-TOKEN": decodeURIComponent(token) } : {}),
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(json ? { "Content-Type": "application/json" } : {}) },
      body: form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : undefined
    });
    return { status: response.status, body: await response.text() };
  }, { method, path, form, json });
}

async function expect(answer, status, what) {
  const response = await answer;
  if (response.status !== status) throw new Error(`${what} answered ${response.status}: ${response.body.slice(0, 300)}`);
  try {
    return JSON.parse(response.body);
  } catch {
    return undefined;
  }
}

async function signIn(username, secret) {
  await context.clearCookies();
  await page.goto(`${origin}/login`);
  await expect(call("GET", "/api/session"), 200, "The session probe");
  await expect(call("POST", "/api/session", { form: { username, password: secret } }), 200, `Sign-in as ${username}`);
  return expect(call("GET", "/api/session"), 200, `The session of ${username}`);
}

async function prepare(account) {
  if (account === null) {
    await context.clearCookies();
    return {};
  }
  if (account === "member") {
    await signIn("member0001", password);
    return {};
  }
  const kept = JSON.parse(readFileSync(administratorFile, "utf8"));
  const session = kept.password
    ? await signIn("admin", kept.password).catch(() => signIn("admin", password))
    : await signIn("admin", password);
  if (session?.passwordChangeRequired) {
    const replacement = randomBytes(24).toString("base64url");
    await expect(call("PUT", "/api/account/initial-password", { json: { password: replacement } }), 204,
      "The initial password change");
    writeFileSync(administratorFile, `${JSON.stringify({ password: replacement })}\n`);
    await signIn("admin", replacement);
  }
  const roster = await expect(call("POST", "/api/admin/roster-search", { json: { limit: 1, sortBy: "NAME", sortDirection: "ASC" } }),
    200, "The roster search");
  return { personId: roster.entries[0]?.personId, cardId: SEEDED_MEMBER_CARD };
}

async function measure(entry, identifiers) {
  const path = resolvedPath(entry.path, identifiers);
  const reports = [];
  for (let run = 1; run <= entry.runs; run++) {
    const result = await lighthouse(`${origin}${path}`, { port: DEBUGGING_PORT, output: ["html", "json"], logLevel: "error" },
      entry.formFactor === "desktop" ? desktopConfig : undefined);
    if (!result) throw new Error("Lighthouse returned no result");
    const failure = landingFailure(result.lhr, path);
    if (failure) return { failure };
    reports.push(result);
  }
  const valid = filterToValidRuns(reports.map((result) => result.lhr));
  if (valid.length === 0) return { failure: "no run produced FCP and TTI" };
  const median = computeMedianRun(valid);
  return { result: reports.find((result) => result.lhr === median) };
}

mkdirSync(join(output, "reports"), { recursive: true });
await page.goto(`${origin}/`);
const results = [];
let prepared;
for (const entry of lighthousePlan()) {
  const name = `${entry.formFactor}${entry.path.replaceAll(/[/:]+/g, "-").replace(/-$/, "") || "-court-plan"}`;
  const summary = { path: entry.path, formFactor: entry.formFactor, runs: entry.runs };
  process.stdout.write(`${entry.formFactor} ${entry.path}: measuring\n`);
  try {
    if (prepared?.account !== entry.account) {
      prepared = { account: entry.account };
      prepared.identifiers = await prepare(entry.account).catch((error) => { prepared.error = error; });
    }
    if (prepared.error) throw prepared.error;
    const { result, failure } = await measure(entry, prepared.identifiers);
    if (failure) summary.failure = failure;
    else {
      writeFileSync(join(output, "reports", `${name}.html`), result.report[0]);
      writeFileSync(join(output, "reports", `${name}.json`), result.report[1]);
      summary.report = reportSummary(result.lhr);
    }
  } catch (error) {
    summary.failure = error.message;
  }
  process.stdout.write(`${entry.formFactor} ${entry.path}: ${summary.failure ?? "measured"}\n`);
  results.push(summary);
  writeFileSync(join(output, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
}
await context.close();
