import { copyFileSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { capture } from "../lib/checks";
import { runPath } from "../lib/context";

const font = readFileSync(new URL("../../frontend/node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2", import.meta.url)).toString("base64");
const cases = [
  { key: "adjacent", situation: "static text added beside a shorter date", previous: "28.10.2026 Label", current: "1.1.2026 X Label" },
  { key: "overlay", situation: "a changed badge partially covering a date", previous: "28.10.2026", current: "29.10.2026" },
  { key: "welcome", situation: "changed ordinary welcome text", previous: "Welcome everyone", current: "Welcome visitors" },
  { key: "format", situation: "a changed date presentation format", previous: "28.10.2026", current: "10/28/2026" },
  { key: "background", situation: "a changed ancestor background behind a date", previous: "28.10.2026", current: "29.10.2026" },
  { key: "date-label", situation: "a changed date-shaped booking card label in usage", previous: "28.10.2026", current: "29.10.2026" },
  { key: "numeric-label", situation: "a changed numeric booking card label in usage", previous: "1", current: "2" },
  { key: "pseudo", situation: "a changed generated badge partly covering a date", previous: "28.10.2026", current: "29.10.2026" }
];

for (const fixture of cases) {
  test(`given ${fixture.situation}, when native comparison pairs are captured, then the original images retain that static change`, async ({ page }, info) => {
    // given
    await page.setViewportSize({ width: 640, height: 480 });
    const html = `<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><style>
      @font-face { font-family: Capture; font-style: normal; font-weight: 100 900; src: url(data:font/woff2;base64,${font}); }
      body { min-height:800px;margin:8px;font:16px/24px Capture; }
      [data-testid="rejection-value"] { position:absolute;left:40px;top:60px;margin:0; }
      [data-testid="pseudo-badge"]::before { content:"";position:absolute;left:var(--left);top:var(--top);width:8px;height:var(--height);background:var(--color);pointer-events:none;z-index:2; }
      </style></head><body><h1>Comparison</h1><div data-testid="paint">${["numeric-label", "date-label"].includes(fixture.key) ? '<div data-testid="usage-report"><div data-testid="usage-cancelled-card-label">' : ""}<p data-testid="rejection-value">${fixture.previous}</p>${["numeric-label", "date-label"].includes(fixture.key) ? "</div></div>" : ""}</div>
      ${fixture.key === "overlay" ? '<div data-testid="badge"></div>' : ""}
      ${fixture.key === "pseudo" ? '<div data-testid="pseudo-badge" style="display:contents"></div>' : ""}</body></html>`;
    await page.goto(`data:text/html,${encodeURIComponent(html)}`);
    await page.evaluate(async () => {
      await document.fonts.load("16px Capture");
      await document.fonts.load("bold 32px Capture");
      await document.fonts.ready;
    });
    if (fixture.key === "overlay") await page.getByTestId("rejection-value").evaluate((element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      const box = range.getBoundingClientRect();
      const badge = document.querySelector('[data-testid="badge"]') as HTMLElement;
      Object.assign(badge.style, { position: "absolute", left: `${box.left}px`, top: `${box.top + 1}px`, width: "8px",
        height: `${box.height - 2}px`, backgroundColor: "red", pointerEvents: "none", zIndex: "2" });
    });
    if (fixture.key === "background") await page.getByTestId("rejection-value").evaluate((element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      const text = range.getBoundingClientRect(); const box = element.getBoundingClientRect();
      const paint = element.parentElement!;
      Object.assign(paint.style, { position: "absolute", left: `${text.left}px`, top: `${text.top}px`, width: `${text.width}px`, height: `${text.height}px`, backgroundColor: "red" });
      Object.assign((element as HTMLElement).style, { left: `${box.left - text.left}px`, top: `${box.top - text.top}px` });
    });
    if (fixture.key === "pseudo") await page.getByTestId("rejection-value").evaluate((element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      const box = range.getBoundingClientRect(); const badge = document.querySelector('[data-testid="pseudo-badge"]') as HTMLElement;
      for (const [key, value] of Object.entries({ "--left": `${box.left}px`, "--top": `${box.top + 1}px`, "--height": `${box.height - 2}px`, "--color": "red" })) badge.style.setProperty(key, value);
    });
    const images: Buffer[] = [];
    const records: { masks: unknown[] }[] = [];
    // when
    for (const label of ["previous", "current"] as const) {
      if (label === "current") {
        await page.getByTestId("rejection-value").evaluate((element, value) => { element.textContent = value; }, fixture.current);
        if (fixture.key === "overlay") await page.getByTestId("badge").evaluate((element) => { (element as HTMLElement).style.backgroundColor = "blue"; });
        if (fixture.key === "background") await page.getByTestId("paint").evaluate((element) => { (element as HTMLElement).style.backgroundColor = "blue"; });
        if (fixture.key === "pseudo") await page.getByTestId("pseudo-badge").evaluate((element) => { (element as HTMLElement).style.setProperty("--color", "blue"); });
      }
      await capture(page, label);
      const rows = readFileSync(runPath("metrics.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
      const metric = rows.filter((row) => row.test === info.title && row.project === info.project.name && row.label === label).at(-1);
      for (const suffix of ["", "-full"]) for (const extension of [".png", ".comparison.json"]) {
        const source = metric.shot.replace(/\.png$/, `${suffix}${extension}`);
        copyFileSync(source, info.outputPath(`${fixture.key}-${label}${suffix}${extension}`));
        if (extension === ".comparison.json") records.push(JSON.parse(readFileSync(source, "utf8")));
      }
      images.push(readFileSync(metric.shot));
    }
    // then
    await expect(page.getByTestId("rejection-value")).toHaveText(fixture.current);
    expect(images[0].equals(images[1]), "the native pair includes the actual changed text or badge pixels").toBe(false);
    if (["overlay", "welcome", "pseudo", "numeric-label", "date-label"].includes(fixture.key)) for (const record of records) {
      expect(record.masks, "static welcome text and partially covered dates remain unmasked in both image modes").toHaveLength(0);
    }
  });
}
