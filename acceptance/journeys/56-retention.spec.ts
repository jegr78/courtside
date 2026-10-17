import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { capture } from "../lib/checks";
import { openAs } from "../lib/session";
import { step } from "../lib/steps";
import { projectName } from "../lib/journey";
import { adminPost, adminPut, apiAs } from "../lib/api";
import { recordCreated } from "../lib/ledger";
import { readPeriods, restorePeriods } from "../lib/retention";
import { differentPeriod, RETENTION_BLOCK_REASONS, RETENTION_CATEGORIES } from "../lib/core.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COUNT = /\d/;

type Preview = {
  previewId: string;
  expiresAt: string;
  bookings?: { endedBefore: string; bookings: number; series: number };
  formerMembers?: { membershipEndedBefore: string; people: number; accounts: number };
  blocked: { personId: string; reason: string }[];
};

const isCount = (value: unknown) => Number.isInteger(value) && (value as number) >= 0;

test.beforeEach(() => { test.skip(projectName() !== "desktop-chrome", "retention periods are global, so one profile changes them"); });

test("given the club's retention periods, when the board sets both and previews a run, then the preview counts and names the blocked by reason, no run is confirmed and the periods return to what they were", async ({ browser }) => {
  // given
  const admin = await apiAs("admin");
  const before = await readPeriods(admin);
  for (const category of RETENTION_CATEGORIES) {
    recordCreated({ kind: "retention-policy", id: category, before: before[category as keyof typeof before], by: "admin", project: projectName() });
  }
  const page = await openAs(browser, "admin");
  let runsAsked = 0;
  // The acceptance instance holds the club's records, so a run is never let through, whatever the page does.
  await page.route("**/api/admin/retention/previews/*/run", async (route) => { runsAsked++; await route.abort(); });
  try {
    // when
    await step("admin", "retention periods", async () => {
      await page.goto("/admin/retention");
      await expect(page.getByTestId("admin-retention-view"), "product: the retention page renders").toBeVisible();
      for (const category of RETENTION_CATEGORIES) {
        const months = differentPeriod(before[category as keyof typeof before]);
        await page.getByTestId(`retention-months-${category}`).fill(String(months));
        await page.getByTestId(`retention-save-${category}`).click();
        await expect(page.getByTestId("retention-success"), `product: the ${category} period is saved`).toBeVisible();
        await expect(page.getByTestId(`retention-state-${category}`), `product: ${category} reads as set`).toHaveAttribute("data-configured", "true");
        await expect(page.getByTestId(`retention-state-${category}`), `product: ${category} shows its months`).toContainText(String(months));
      }
      await capture(page, "retention-periods");
    });

    await step("admin", "retention preview", async () => {
      await page.getByTestId("retention-preview").click();
      await expect(page.getByTestId("retention-preview-result"), "product: the preview answers").toBeVisible();
      await expect(page.getByTestId("retention-preview-bookings"), "product: the preview counts bookings").toHaveText(COUNT);
      await expect(page.getByTestId("retention-preview-former-members"), "product: the preview counts former members").toHaveText(COUNT);
      const rows = page.getByTestId("retention-blocked-row");
      if (await rows.count() === 0) {
        await expect(page.getByTestId("retention-blocked-none"), "product: a preview that blocks nobody says so").toBeVisible();
      }
      for (const row of await rows.all()) {
        expect(RETENTION_BLOCK_REASONS, "product: each blocked person carries a known reason").toContain(await row.getAttribute("data-reason"));
        expect((await row.innerText()).trim(), "product: the reason is written out").not.toBe("");
        expect(await row.getByRole("link").getAttribute("href"), "product: the blocked person opens on the roster").toMatch(/^\/admin\/roster\/[0-9a-f-]{36}$/);
      }
      await expect(page.getByTestId("retention-acknowledge"), "product: the run is not acknowledged by default").not.toBeChecked();
      await expect(page.getByTestId("retention-run"), "product: the run waits for the acknowledgement").toBeDisabled();
      await capture(page, "retention-preview");
    });

    // then
    const answer = await adminPost(admin, "/api/admin/retention/previews", {});
    expect(answer.status(), "product: a preview is created").toBe(201);
    const preview = await answer.json() as Preview;
    expect(preview.previewId, "product: the preview has an id").toMatch(UUID);
    expect(Date.parse(preview.expiresAt), "product: the preview expires later").toBeGreaterThan(Date.now());
    expect([preview.bookings?.bookings, preview.bookings?.series, preview.formerMembers?.people, preview.formerMembers?.accounts].every(isCount),
      "product: both configured categories are counted").toBe(true);
    for (const record of preview.blocked) {
      expect(record.personId, "product: a blocked record names a person id").toMatch(UUID);
      expect(RETENTION_BLOCK_REASONS, "product: a blocked record carries a known reason").toContain(record.reason);
    }

    const refusedPeriod = await adminPut(admin, "/api/admin/retention/policies/BOOKINGS", { retainMonths: 0 });
    expect(refusedPeriod.status(), "product: a period of no months is refused").toBe(400);
    expect((await refusedPeriod.json()).fieldErrors?.[0]?.field, "product: the refusal names the months").toBe("retainMonths");

    // A preview id nobody created runs nothing and shows the typed refusal.
    const unknown = await adminPost(admin, `/api/admin/retention/previews/${randomUUID()}/run`, {});
    expect(unknown.status(), "product: an unknown preview is not run").toBe(404);
    expect((await unknown.json()).type, "product: the refusal is typed").toBe("urn:courtside:error:retention-preview-not-found");

    const member = await (await apiAs("memberA")).get("/api/admin/retention/policies");
    expect(member.status(), "product: a member cannot read the retention periods").toBe(403);
    expect((await member.json()).type, "product: the member's refusal is typed").toBe("urn:courtside:error:access-denied");
  } finally {
    const restored = await restorePeriods(admin);
    await page.context().close();
    expect(restored.filter((outcome) => outcome.status >= 300), "product: every period is put back").toEqual([]);
    expect(await readPeriods(admin), "the periods are what they were before the run").toEqual(before);
    expect(runsAsked, "the page never asked for a retention run").toBe(0);
  }
});
