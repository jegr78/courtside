import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { capture } from "../lib/checks";
import { runPath } from "../lib/context";
import { runDataMaskProbe } from "../lib/comparison-masks.mjs";

type MaskRectangle = { x: number; y: number; width: number; height: number };

const font = readFileSync(new URL("../../frontend/node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2", import.meta.url)).toString("base64");
const appStyles = readFileSync(new URL("../../frontend/src/styles.css", import.meta.url), "utf8");
const body = `<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><style>
@font-face { font-family: Capture; font-style: normal; font-weight: 100 900; src: url(data:font/woff2;base64,${font}); }
${appStyles}
body { min-height: 800px; margin: 0; padding: 8px; box-sizing: border-box; font: 16px/24px Capture; } p { margin: 8px 0; } input, button, time { font: inherit; } input:not([type="checkbox"]):not([type="radio"]) { width: 160px; }
</style></head><body><main><h1>Profile</h1><p id="date" data-testid="allocation-period">27.10.2026</p><p id="time" data-testid="managed-period">12:34 PM</p>
<p><span data-testid="my-messages-unread">31</span> unread messages</p>
<button data-testid="build-identity">v0.4.0-rc.1 · abcdef1</button><p id="name">UAT-wording-abc12345</p>
<p data-testid="static-copy">Court 2 has 4 rules</p><p data-testid="raw-iso"><time>2026-10-27T11:34:00+02:00</time></p>
<input data-testid="event-date" type="date" value="2026-10-27"><p><input data-testid="club-option" type="checkbox" checked><input type="radio" checked></p>
<span class="date-time-field"><input data-testid="localized-date" type="text" data-date-time-type="date" value="27.10.2026"><input type="hidden" value="2026-10-27"></span>
<span class="date-time-field"><input data-testid="localized-time" type="text" data-date-time-type="time" value="12:34 PM"><input type="hidden" value="12:34"></span>
<section data-testid="usage-report"><div data-testid="usage-cancelled-card-label">1</div><dd data-testid="usage-cancelled-value">16</dd></section>
<section data-testid="statistics-progression"><span data-testid="statistics-bucket-2026-10-27-label">27.10.2026</span></section></main></body></html>`;

test("given native screenshots with five kinds of run data, when capture records comparison evidence, then only bounded changing text is masked", async ({ page }, info) => {
  // given
  if (!info.project.use.isMobile) await page.setViewportSize({ width: 640, height: 480 });
  await page.goto(`data:text/html,${encodeURIComponent(body)}`);
  await page.evaluate(async () => {
    await document.fonts.load("16px Capture");
    await document.fonts.load("bold 32px Capture");
    await document.fonts.ready;
  });
  const records = [];
  // when
  for (const label of ["previous", "current"]) {
    if (label === "current") await page.evaluate(() => {
      document.getElementById("date")!.textContent = "28.10.2026";
      document.getElementById("time")!.textContent = "12:35 PM";
      document.querySelector('[data-testid="my-messages-unread"]')!.textContent = "32";
      document.querySelector('[data-testid="build-identity"]')!.textContent = "v0.4.0-rc.2 · bcdef12";
      document.getElementById("name")!.textContent = "UAT-wording-ade67895";
      (document.querySelector('[data-testid="event-date"]') as HTMLInputElement).value = "2026-10-28";
      (document.querySelector('[data-testid="localized-date"]') as HTMLInputElement).value = "28.10.2026";
      (document.querySelector('[data-testid="localized-time"]') as HTMLInputElement).value = "12:35 PM";
      document.querySelector('[data-testid="usage-cancelled-value"]')!.textContent = "17";
      document.querySelector('[data-testid^="statistics-bucket-"]')!.textContent = "28.10.2026";
    });
    await capture(page, label);
    const rows = readFileSync(runPath("metrics.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const metric = rows.filter((row) => row.test === info.title && row.project === info.project.name && row.label === label).at(-1);
    const path = metric.shot.replace(/\.png$/, ".comparison.json");
    // then
    expect(existsSync(path), "the real capture producer writes its comparison evidence").toBe(true);
    const record = JSON.parse(readFileSync(path, "utf8"));
    expect(record.safe).toBe(true);
    expect(new Set(record.masks.map((mask: { kind: string }) => mask.kind))).toEqual(new Set(["date", "time", "count", "version", "generated-name"]));
    const image = readFileSync(metric.shot);
    expect(record.image.width).toBe(image.readUInt32BE(16));
    expect(record.image.height).toBe(image.readUInt32BE(20));
    expect(Math.round(record.capture.width * record.capture.devicePixelRatio)).toBe(record.image.width);
    expect(Math.round(record.capture.height * record.capture.devicePixelRatio)).toBe(record.image.height);
    expect(record.capture.devicePixelRatio).toBe(info.project.use.deviceScaleFactor ?? 1);
    expect(record.capture.locale).toBe(await page.evaluate(() => navigator.language));
    expect(record.capture.timeZone).toBe(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
    const input = await page.getByTestId("event-date").boundingBox();
    const controls = record.masks.filter((mask: { key: string }) => mask.key.endsWith("/input:0"));
    expect(controls).toHaveLength(1);
    for (const rect of controls[0].rects as MaskRectangle[]) {
      expect(rect.x).toBeGreaterThanOrEqual(input!.x + 1);
      expect(rect.y).toBeGreaterThanOrEqual(input!.y + 1);
      expect(rect.x + rect.width).toBeLessThanOrEqual(input!.x + input!.width - 32);
      expect(rect.y + rect.height).toBeLessThanOrEqual(input!.y + input!.height - 1);
    }
    expect(JSON.stringify(record)).not.toMatch(/27\.10\.2026|28\.10\.2026|abc12345|ade67895|11:34:00/);
    for (const id of ["static-copy", "raw-iso", "usage-cancelled-card-label"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(record.masks.flatMap((mask: { rects: MaskRectangle[] }) => mask.rects)
        .some((rect: MaskRectangle) => rect.x < box!.x + box!.width && rect.x + rect.width > box!.x
          && rect.y < box!.y + box!.height && rect.y + rect.height > box!.y), `${id} remains visible to comparison`).toBe(false);
    }
    for (const suffix of ["", "-full"]) {
      const source = metric.shot.replace(/\.png$/, `${suffix}.png`);
      const evidence = JSON.parse(readFileSync(source.replace(/\.png$/, ".comparison.json"), "utf8"));
      if (suffix === "-full") {
        const bucket = await page.getByTestId("statistics-bucket-2026-10-27-label").boundingBox();
        expect(evidence.masks.filter((mask: { kind: string }) => mask.kind === "date").some((mask: { rects: MaskRectangle[] }) => mask.rects.some((rect) => rect.y >= bucket!.y && rect.y < bucket!.y + bucket!.height)), "explicit temporal bucket labels remain maskable").toBe(true);
        const figure = await page.getByTestId("usage-cancelled-value").boundingBox();
        expect(evidence.masks.filter((mask: { kind: string; rects: MaskRectangle[] }) => mask.kind === "count").some((mask: { rects: MaskRectangle[] }) => mask.rects.some((rect) => rect.y >= figure!.y && rect.y < figure!.y + figure!.height)), "usage metrics keep their bounded changing-number mask").toBe(true);
      }
      if (suffix === "-full") expect(evidence.masks.filter((mask: { key: string }) => mask.key.includes("/localized-input:")), "application text date and time fields produce bounded masks beside styled checkboxes").toHaveLength(2);
      copyFileSync(source, info.outputPath(`${label}${suffix}.png`));
      copyFileSync(source.replace(/\.png$/, ".comparison.json"), info.outputPath(`${label}${suffix}.comparison.json`));
    }
    records.push(record);
  }
  expect(records[0].capture).toEqual(records[1].capture);
});

test("given clipped date text and a fixed unread count, when comparison geometry is collected, then clipped pixels and uncertain full-page positions remain unmasked", async ({ page }) => {
  // given
  await page.setViewportSize({ width: 640, height: 480 });
  await page.goto(`data:text/html,${encodeURIComponent('<html><body style="min-height:800px;font:16px sans-serif"><time data-testid="clipped-date" style="position:absolute;left:200px;top:100px;overflow:hidden;width:40px;white-space:nowrap">28.10.2026</time><span data-testid="my-messages-unread" style="position:fixed;left:20px;top:40px">31</span><time style="position:absolute;left:20px;top:200px">28.10.2026</time></body></html>')}`);
  const clipped = await page.getByTestId("clipped-date").boundingBox();
  // when
  const viewport = await page.evaluate(runDataMaskProbe, { mode: "viewport" });
  const full = await page.evaluate(runDataMaskProbe, { mode: "full" });
  // then
  expect(viewport.masks.some((mask) => mask.kind === "count")).toBe(true);
  expect(full.masks.some((mask) => mask.kind === "count")).toBe(false);
  for (const record of [viewport, full]) {
    expect(record.masks.some((mask) => mask.rects.some((rect: MaskRectangle) => rect.x < clipped!.x + clipped!.width && rect.x + rect.width > clipped!.x
      && rect.y < clipped!.y + clipped!.height && rect.y + rect.height > clipped!.y)), `${record.capture.mode} leaves clipped content exposed`).toBe(false);
  }
});

for (const change of ["raw", "unparsed", "invalid", "escaped-pseudo"]) {
  test(`given ${change} application field evidence, when mask geometry is collected, then unsupported pixels remain exposed`, async ({ page }) => {
    // given
    await page.setViewportSize({ width: 640, height: 480 });
    await page.goto(`data:text/html,${encodeURIComponent(body)}`);
    const input = page.getByTestId("localized-date");
    await input.evaluate((element, value) => {
      const field = element as HTMLInputElement;
      if (value === "raw") field.value = "2026-10-27";
      if (value === "unparsed") field.setAttribute("data-date-time-unparsed", "true");
      if (value === "invalid") field.setCustomValidity("Invalid date");
    }, change);
    if (change === "escaped-pseudo") await page.addStyleTag({ content: 'input[type="checkbox"]::before { position:absolute;left:40px;top:60px;width:100px;height:20px;transform:none; }' });
    // when
    const records = await Promise.all(["viewport", "full"].map((mode) => page.evaluate(runDataMaskProbe, { mode })));
    // then
    for (const record of records) {
      if (change === "escaped-pseudo") expect(record.masks).toHaveLength(0);
      else expect(record.masks.filter((mask) => mask.key.includes("/localized-input:date:"))).toHaveLength(0);
    }
  });
}
