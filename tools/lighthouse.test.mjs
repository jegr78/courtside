import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PINNED_BROWSER_IMAGE } from "../frontend/e2e/container-images.ts";
import { landingFailure, lighthousePlan, resolvedPath, summaryMarkdown } from "../lighthouse/pages.mjs";
import { lighthouseContainerPlan, lighthouseOutcome } from "./courtside.lighthouse.mjs";

const json = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const routes = readFileSync(new URL("../frontend/src/views/AdminRoutes.tsx", import.meta.url), "utf8");

const report = ({ requested = "https://proxy/my-bookings", final = requested, runtimeError, scores = {} } = {}) => ({
  requestedUrl: requested,
  finalDisplayedUrl: final,
  ...(runtimeError ? { runtimeError } : {}),
  categories: Object.fromEntries(["performance", "accessibility", "best-practices", "seo"]
    .map((id) => [id, { score: scores[id] ?? 1 }])),
  audits: { ...Object.fromEntries(["first-contentful-paint", "largest-contentful-paint", "total-blocking-time"]
    .map((id) => [id, { numericValue: 100 }])), "cumulative-layout-shift": { numericValue: 0.1 } },
  environment: { benchmarkIndex: 1500 }
});

test("given the page plan, when it is built, then every page runs on mobile and desktop and member pages run three times", () => {
  // when
  const plan = lighthousePlan();
  // then
  for (const path of ["/", "/login", "/my-bookings", "/my-messages"]) {
    for (const formFactor of ["mobile", "desktop"]) {
      assert.equal(plan.find((page) => page.path === path && page.formFactor === formFactor)?.runs, 3,
        `${path} on ${formFactor} reports a median of three runs`);
    }
  }
  assert.ok(plan.filter((page) => page.account === "admin").every((page) => page.runs === 1),
    "an administration route runs once");
  assert.deepEqual(plan.filter((page) => page.account === null).map((page) => page.path), ["/", "/login", "/", "/login"],
    "the court plan and sign-in are measured signed out");
});

test("given the administration routes, when the plan is read, then it measures every route the admin surface declares", () => {
  // given
  const declared = [...routes.matchAll(/<Route (?:index|path="([^"*]+)")/g)]
    .map(([, path]) => path ?? "")
    .filter((path) => path !== "facility");
  const nested = declared.map((path) => ["courts", "access-points", "opening-hours", "opening-hours/exceptions",
    "booking-cards", "booking-cards/:cardId", "slot-fillers"].includes(path) ? `/admin/facility/${path}` : `/admin/${path}`)
    .map((path) => path.replace(/\/$/, ""));
  // when
  const measured = new Set(lighthousePlan().filter((page) => page.account === "admin").map((page) => page.path));
  // then
  assert.equal(nested.length, 28, "the admin surface declares 27 routes plus the facility index redirect");
  for (const path of nested.filter((path) => path !== "/admin/facility")) {
    assert.ok(measured.has(path), `${path} is measured`);
  }
});

test("given a route with an identifier, when it is resolved, then the identifier is filled and a missing one is refused", () => {
  // when / then
  assert.equal(resolvedPath("/admin/roster/:personId", { personId: "p-1" }), "/admin/roster/p-1");
  assert.equal(resolvedPath("/my-bookings", {}), "/my-bookings");
  assert.throws(() => resolvedPath("/admin/roster/:personId", {}), /No personId for \/admin\/roster\/:personId/);
});

test("given a report, when the page landed elsewhere or failed, then the failure names what happened", () => {
  // when / then
  assert.equal(landingFailure(report(), "/my-bookings"), undefined);
  assert.match(landingFailure(report({ final: "https://proxy/initial-password" }), "/my-bookings"),
    /landed on \/initial-password instead of \/my-bookings/);
  assert.match(landingFailure(report({ runtimeError: { code: "ERRORED_DOCUMENT_REQUEST", message: "Status 502" } }),
    "/my-bookings"), /ERRORED_DOCUMENT_REQUEST: Status 502/);
});

test("given measured pages and a failure, when the summary is written, then it lists scores, metrics and the failure", () => {
  // given
  const results = [
    { path: "/", formFactor: "mobile", runs: 3, report: report({ requested: "https://proxy/", scores: { performance: 0.95 } }) },
    { path: "/admin/audit", formFactor: "desktop", runs: 1, failure: "landed on / instead of /admin/audit" }
  ];
  // when
  const markdown = summaryMarkdown(results, { image: "ghcr.io/jegr78/courtside@sha256:abc", revision: "f1faef0f" });
  // then
  assert.match(markdown, /ghcr\.io\/jegr78\/courtside@sha256:abc/);
  assert.match(markdown, /\| `\/` \| mobile \| 3 \| 95 \| 100 \| 100 \| 100 \| 100 ms \| 100 ms \| 100 ms \| 0\.100 \| 1500 \|/);
  assert.match(markdown, /\| `\/admin\/audit` \| desktop \| 1 \| failed: landed on \/ instead of \/admin\/audit \|/);
});

test("given the Lighthouse package, when its browser is read, then it drives the Chromium of the pinned Playwright image", () => {
  // given
  const manifest = json("lighthouse/package.json");
  const lock = json("lighthouse/package-lock.json");
  // when
  const imageVersion = /playwright:v([\d.]+)-/.exec(PINNED_BROWSER_IMAGE)?.[1];
  // then
  assert.equal(manifest.dependencies["playwright-core"], imageVersion, "the driver matches the browser image");
  assert.equal(lock.packages["node_modules/playwright-core"].version, imageVersion);
  assert.match(manifest.dependencies.lighthouse, /^\d+\.\d+\.\d+$/, "Lighthouse is pinned exactly");
});

test("given a verified performance target, when the Lighthouse container is planned, then it runs the pinned browser on the load network", () => {
  // when
  const plan = lighthouseContainerPlan({ root: "/repo", output: "/repo/build/lighthouse",
    stateFile: "/repo/build/perf-environment.json", certificatePin: "pin=", user: ["--user", "1000:1000"] });
  // then
  assert.equal(plan.args.at(-3), PINNED_BROWSER_IMAGE);
  assert.deepEqual(plan.args.slice(plan.args.indexOf("--network"), plan.args.indexOf("--network") + 2),
    ["--network", "courtside-perf_load"]);
  assert.ok(plan.args.includes("/repo/lighthouse:/lighthouse:ro"), "the runner's code is mounted read-only");
  assert.ok(plan.args.includes("/repo/build/perf-environment.json:/run/courtside/perf.json:ro"),
    "the shared password stays in its private file");
  assert.ok(plan.args.includes("LIGHTHOUSE_CERTIFICATE_PIN=pin="), "the browser trusts only the verified certificate");
});

test("given page results and the container's exit, when the outcome is read, then every failure is named and none is dropped", () => {
  // when / then
  assert.deepEqual(lighthouseOutcome([{ path: "/", formFactor: "mobile", report: {} }], 0), []);
  assert.deepEqual(lighthouseOutcome([{ path: "/admin", formFactor: "desktop", failure: "landed on /" }], 1),
    ["desktop /admin: landed on /", "the Lighthouse container exited with 1"]);
});
