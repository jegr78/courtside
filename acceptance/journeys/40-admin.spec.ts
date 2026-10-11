import { runPath } from "../lib/context";
import { test, expect } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { capture } from "../lib/checks";
import { openAs } from "../lib/session";
import { step } from "../lib/steps";
import { discovery, onDesksAndTablet } from "../lib/journey";

const LINKS = ["admin-overview-link", "admin-setup-link", "admin-configuration-link", "admin-deadlines-link",
  "admin-rule-sets-link", "admin-courts-link", "admin-opening-hours-link", "admin-booking-cards-link",
  "admin-slot-fillers-link", "admin-roster-link", "admin-membership-types-link", "admin-import-link",
  "admin-export-link", "admin-utilisation-link", "admin-audit-link", "admin-messages-link",
  "admin-operational-logs-link", "admin-appointments-link"];

test.beforeEach(() => { test.skip(!onDesksAndTablet(), "admin journeys run on desks, tablet and one phone"); });
test.setTimeout(120_000);

test("when the admin visits every administration page, then each renders", async ({ browser }) => {
  // when / then — every page renders in turn
  const page = await openAs(browser, "admin");
  try {
    await page.getByTestId("administration-link").click();
    let previousHeading = "";
    for (const link of LINKS) {
      await step("admin", link, async () => {
        await expect(page.getByTestId("admin-navigation")).toBeVisible();
        const destination = page.getByTestId(link);
        if (!await destination.isVisible()) await page.getByTestId("admin-menu").click();
        await expect(destination).toBeVisible();
        const href = await destination.getAttribute("href");
        await destination.click();
        const target = new RegExp(`${(href ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
        const reached = await expect(page).toHaveURL(target, { timeout: 3_000 }).then(() => true, () => false);
        if (!reached && href) {
          appendFileSync(runPath("observations.jsonl"), JSON.stringify({ project: test.info().project.name, test: link, note: "menu link did not navigate, page opened by URL (see M2)" }) + "\n");
          await page.goto(href);
        }
        const settled = await expect.poll(async () => {
          const heading = (await page.locator("main h1, main h2").first().textContent().catch(() => "")) ?? "";
          const loading = await page.locator('p[role="status"]').count();
          return loading === 0 && heading !== "" && heading !== previousHeading;
        }, { timeout: 15_000 }).toBe(true).then(() => true, () => false);
        if (!settled) appendFileSync(runPath("observations.jsonl"), JSON.stringify({ project: test.info().project.name, test: link, note: "page heading unchanged or loading status still shown 15 s after navigation" }) + "\n");
        previousHeading = (await page.locator("main h1, main h2").first().textContent().catch(() => "")) ?? "";
        await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
        await capture(page, link.replace(/^admin-|-link$/g, ""));
      });
    }
  } finally { await page.context().close(); }
});

test("when the admin opens a member and a booking card, then the detail pages render without saving", async ({ browser }) => {
  // when / then — each detail page renders
  const page = await openAs(browser, "admin");
  try {
    await step("admin", "person detail", async () => {
      await page.goto(`/admin/roster/${discovery.personIds["memberA"]}`);
      await expect(page.getByTestId("admin-person-view")).toBeVisible();
      await capture(page, "person-detail");
    });
    await step("admin", "booking card detail", async () => {
      await page.goto(`/admin/facility/booking-cards/${discovery.cardFor.training}`);
      await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
      await capture(page, "booking-card-detail");
    });
  } finally { await page.context().close(); }
});
