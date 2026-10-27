import { existsSync, readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { capture, inCapturePhase, watch } from "../lib/checks";
import { runPath } from "../lib/context";

const rows = (name: string) => readFileSync(runPath(name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

test("given browser errors around a capture, when recorded, then their time and actual operation remain available", async ({ page }, info) => {
  // given
  await page.route("https://club.example.org/**", (route) => route.fulfill(route.request().url().includes("observer.js")
    ? { contentType: "text/javascript", body: 'setTimeout(() => { throw new Error("navigation-observation"); }, 0);' }
    : { contentType: "text/html", body: '<html lang="en"><head><title>Plan</title></head><body><main><h1>Plan</h1></main><script src="/observer.js?token=fixture-secret"></script></body></html>' }));
  const start = Date.now();
  watch(page);
  const navigationError = page.waitForEvent("pageerror");
  await page.goto("https://club.example.org/plan");
  await navigationError;
  await page.evaluate(() => {
    const read = Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth")!.get!;
    Object.defineProperty(document.documentElement, "scrollWidth", { get() {
      console.error("layout-observation");
      return read.call(this);
    } });
  });
  const screenshot = page.screenshot.bind(page);
  page.screenshot = async (...args: Parameters<typeof page.screenshot>) => {
    await page.evaluate((full) => console.error(full ? "full-page-observation" : "viewport-observation"), args[0]?.fullPage);
    return screenshot(...args);
  };
  const analyze = AxeBuilder.prototype.analyze;
  AxeBuilder.prototype.analyze = async function (...args: Parameters<typeof analyze>) {
    await page.evaluate(() => console.error("axe-observation"));
    return analyze.apply(this, args);
  };

  // when
  try { await capture(page, "console-context"); } finally {
    page.screenshot = screenshot;
    AxeBuilder.prototype.analyze = analyze;
  }

  // then
  const metric = rows("metrics.jsonl").filter((row) => row.test === info.title && row.project === info.project.name).at(-1);
  expect(metric.consoleEvents, "captures retain structured browser observations").toBeInstanceOf(Array);
  for (const [message, phase] of [
    ["pageerror: navigation-observation", "journey"],
    ["viewport-observation", "viewport-screenshot"],
    ["full-page-observation", "full-page-screenshot"],
    ["layout-observation", "layout-probe"],
    ["axe-observation", "axe"]
  ]) {
    const event = metric.consoleEvents.find((entry: { message: string; phase: string }) => entry.message === message && entry.phase === phase);
    expect(event, `${message} is attributed to ${phase}`).toBeDefined();
    expect(Date.parse(event.observedAt)).toBeGreaterThanOrEqual(start);
    expect(Date.parse(event.observedAt)).toBeLessThanOrEqual(Date.now());
  }
  const error = metric.consoleEvents.find((event: { kind: string }) => event.kind === "pageerror");
  expect(error.stack, "available browser stack frames survive collection").toContain("observer.js");
  expect(JSON.stringify(metric.consoleEvents), "new diagnostic source fields omit query credentials").not.toContain("fixture-secret");
  const journal = rows("browser-events.jsonl").filter((event) => event.test === info.title && event.project === info.project.name);
  expect(statSync(runPath("browser-events.jsonl")).mode & 0o777, "the diagnostic journal is private to its owner").toBe(0o600);
  for (const event of metric.consoleEvents) expect(journal, "every captured observation was journalled when received").toContainEqual(expect.objectContaining(event));
});

test("given a capture that fails, when the next browser error arrives, then it is journalled outside the failed operation", async ({ page }, info) => {
  // given
  await page.route("https://club.example.org/**", (route) => route.fulfill({
    contentType: "text/html", body: '<html lang="en"><title>Plan</title><main><h1>Plan</h1></main></html>'
  }));
  watch(page);
  await page.goto("https://club.example.org/plan");
  const screenshot = page.screenshot.bind(page);
  page.screenshot = async () => { throw new Error("screenshot unavailable"); };

  // when
  try { await expect(capture(page, "failed-capture")).rejects.toThrow("screenshot unavailable"); } finally {
    page.screenshot = screenshot;
  }
  const received = page.waitForEvent("console", (message) => message.text() === "after-failed-capture");
  await page.evaluate(() => console.error("after-failed-capture"));
  await received;

  // then
  expect(existsSync(runPath("browser-events.jsonl")), "browser errors survive captures that never write metrics").toBe(true);
  const event = rows("browser-events.jsonl").filter((row) => row.test === info.title && row.project === info.project.name).at(-1);
  expect(event.message).toBe("after-failed-capture");
  expect(event.phase, "a failed screenshot cannot label later journey errors").toBe("journey");
  expect(event.capture, "a failed capture cannot label later journey errors").toBeNull();
});

test("given a real ResizeObserver loop, when the browser reports undelivered observations, then the warning remains visible with its phase", async ({ page, browserName }) => {
  test.skip(browserName !== "webkit", "This characterizes the native warning that Playwright exposes as a WebKit page error.");
  // given
  await page.setContent('<main><div id="observed" style="width:100px;height:20px">Plan</div></main>');
  const record = watch(page);
  const received = page.waitForEvent("pageerror", (error) => error.message.includes("ResizeObserver"));

  // when
  try {
    await inCapturePhase(page, "layout-probe", async () => {
      await page.evaluate(() => {
        const element = document.getElementById("observed")!;
        const observer = new ResizeObserver(() => { element.style.width = `${element.clientWidth + 1}px`; });
        (window as unknown as { observer: ResizeObserver }).observer = observer;
        observer.observe(element);
      });
      await received;
    });
  } finally {
    await page.evaluate(() => (window as unknown as { observer?: ResizeObserver }).observer?.disconnect());
  }

  // then
  const event = record.consoleEvents.find((entry) => entry.message.includes("ResizeObserver"));
  expect(event, "unexpected observer errors are never globally suppressed").toBeDefined();
  expect(event!.phase).toBe("layout-probe");
  expect(event!.kind).toBe("pageerror");
  expect(Number.isFinite(Date.parse(event!.observedAt))).toBe(true);
});

test("given a page already watched, when diagnostics attach again, then one browser error has one observation", async ({ page }, info) => {
  // given
  watch(page);
  watch(page);
  const message = `single-observation-${randomUUID()}`;
  const received = page.waitForEvent("console", (event) => event.text() === message);

  // when
  await page.evaluate((value) => console.error(value), message);
  await received;

  // then
  const events = rows("browser-events.jsonl").filter((event) => event.test === info.title && event.project === info.project.name && event.message === message);
  expect(events, "reusing the watcher cannot duplicate browser observations").toHaveLength(1);
});
