import { expect, test } from "./fixtures";
import { admitExternalBookings, become, concretePath, PERSONAS, personas, routerPages } from "./page-sweep";

const BUDGET = 0.1;
const widths = [
  { device: "desk", viewport: { width: 1350, height: 940 } },
  { device: "phone", viewport: { width: 412, height: 823 } }
];

// Each endpoint answers after its own delay, so sections that load separately arrive in a fixed, spread order;
// the context route also delays what the service worker fetches.
function delayFor(pathname: string) {
  let hash = 0;
  for (const character of pathname) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return 150 + (hash % 8) * 150;
}

test.describe("layout shift", () => {
  for (const { device, viewport } of widths) {
    test(`given slow answers on a ${device}, when every page loads, then none shifts beyond the budget`, async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "only Chromium reports layout-shift entries");
      // given
      await admitExternalBookings(page);
      await page.setViewportSize(viewport);
      await page.addInitScript(() => {
        const shifts: { value: number; sources: string[] }[] = [];
        (window as unknown as { courtsideShifts: typeof shifts }).courtsideShifts = shifts;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean; sources: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] }[]) {
            if (entry.hadRecentInput) continue;
            shifts.push({ value: entry.value, sources: entry.sources.map(({ node, previousRect, currentRect }) => {
              const element = node instanceof Element ? node : node?.parentElement;
              const name = element ? `${element.tagName.toLowerCase()}${element.getAttribute("data-testid") ? `[${element.getAttribute("data-testid")}]` : ""}` : "?";
              return `${name} y${Math.round(previousRect.y)}→${Math.round(currentRect.y)} h${Math.round(previousRect.height)}→${Math.round(currentRect.height)}`;
            }) });
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      const findings: string[] = [];

      // when
      for (const persona of PERSONAS.filter((persona) => persona !== "bootstrap-admin")) {
        const paths = routerPages().filter((route) => !route.redirect && personas(route.path).includes(persona)).map((route) => route.path);
        if (paths.length === 0) continue;
        await become(page, persona);
        for (const path of paths) {
          const concrete = await concretePath(page, path);
          if (concrete === undefined) continue;
          await page.context().route("**/api/**", async (route) => {
            await new Promise((resolve) => setTimeout(resolve, delayFor(new URL(route.request().url()).pathname)));
            await route.fallback();
          });
          await page.goto(concrete);
          await page.waitForLoadState("networkidle", { timeout: 20_000 });
          await page.waitForTimeout(500);
          const shifts = await page.evaluate(() => (window as unknown as { courtsideShifts: { value: number; sources: string[] }[] }).courtsideShifts);
          await page.context().unroute("**/api/**");
          const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
          if (total > BUDGET) {
            const largest = [...shifts].sort((a, b) => b.value - a.value).slice(0, 2)
              .map((shift) => `${shift.value.toFixed(3)} ${shift.sources.join(",")}`).join("; ");
            findings.push(`${concrete} as ${persona}: ${total.toFixed(3)} (${largest})`);
          }
        }
      }

      // then
      expect(findings, "a page whose layout shifts beyond the budget while it loads").toEqual([]);
    });
  }
});
