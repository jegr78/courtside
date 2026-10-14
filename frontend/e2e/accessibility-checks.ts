import AxeBuilder from "@axe-core/playwright";
import { expect } from "./fixtures";
import { productFailure } from "./browser-diagnostics";

// axe tags these best-practice only, so a scan by WCAG tags alone never runs them.
const STRUCTURE_RULES = ["page-has-heading-one", "heading-order", "empty-table-header", "landmark-unique"];

export async function axeFindings(page: import("@playwright/test").Page): Promise<string[]> {
  const scan = await new AxeBuilder({ page }).options({
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: Object.fromEntries(STRUCTURE_RULES.map((rule) => [rule, { enabled: true }]))
  }).analyze();
  const ran = new Set([...scan.passes, ...scan.violations, ...scan.incomplete, ...scan.inapplicable].map((rule) => rule.id));
  expect(STRUCTURE_RULES.filter((rule) => !ran.has(rule)), "a structure rule axe left out of the scan").toEqual([]);
  return scan.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id} at ${node.target.join(" ")}`));
}

// axe reads computed colours, so a control still fading into the new theme would be judged mid-way.
export async function transitionsSettled(page: import("@playwright/test").Page) {
  const stillMoving = () => page.evaluate(() => {
    const perElement = new Map<string, number>();
    for (const animation of document.getAnimations()) {
      // WebKit keeps finished transitions in getAnimations(), so only running ones count.
      if (!(animation instanceof CSSTransition) || animation.playState !== "running") continue;
      const { target, pseudoElement } = animation.effect as KeyframeEffect;
      const element = `${target?.nodeName}${pseudoElement ?? ""}`;
      perElement.set(element, (perElement.get(element) ?? 0) + 1);
    }
    return [...perElement].map(([element, count]) => `${count} on ${element}`);
  });
  const quiet = await page.waitForFunction(() => !document.getAnimations().some((animation) =>
    animation instanceof CSSTransition && animation.playState === "running"), undefined, { polling: 50, timeout: 10_000 })
    .then(() => true, () => false);
  if (!quiet) expect(await stillMoving(), "no transition still running when axe scans").toEqual([]);
  // An inherited colour follows its parent's finished transition only in the next frame.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export async function expectNoWcagViolations(page: import("@playwright/test").Page) {
  expect(await axeFindings(page), "an axe rule the page breaks").toEqual([]);
}

export async function signIn(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expectCourtPlanLoaded(page);
}

export async function expectCourtPlanLoaded(page: import("@playwright/test").Page) {
  // A keyboard walk that starts while the plan still renders resumes inside it and laps the footer.
  await expect(page.getByTestId("week-grid")).toBeVisible();
}

type TabWalkPosition = "reached" | "moving" | "lapped" | "trapped";

export async function tabToTestId(page: import("@playwright/test").Page, testId: string, key = "Tab") {
  const focusable = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";
  await expect(page.getByTestId(testId).and(page.locator(focusable)).first()).toBeVisible();
  const walk = await page.evaluateHandle(() => ({ seen: new WeakSet<Element>(), previous: null as Element | null, stays: 0 }));
  try {
    for (;;) {
      const position = await page.evaluate(([state, value]): TabWalkPosition => {
        const active = document.activeElement ?? document.body;
        if (active.getAttribute("data-testid") === value) return "reached";
        if (active === state.previous) {
          state.stays += 1;
          // Chromium walks a date or time input's fields and picker on one active element.
          const passable = active === document.body || (active instanceof HTMLInputElement && ["date", "time"].includes(active.type));
          return passable && state.stays < 8 ? "moving" : "trapped";
        }
        state.previous = active;
        state.stays = 0;
        if (active === document.body) return "moving";
        if (state.seen.has(active)) return "lapped";
        state.seen.add(active);
        return "moving";
      }, [walk, testId] as const);
      if (position === "reached") return;
      if (position === "lapped") throw productFailure(`Keyboard focus did not reach ${testId} within one lap`);
      if (position === "trapped") throw productFailure(`Keyboard focus was trapped before reaching ${testId}`);
      await page.keyboard.press(key);
    }
  } finally {
    await walk.dispose();
  }
}
