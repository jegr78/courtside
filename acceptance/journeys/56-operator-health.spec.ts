import { test, expect } from "../lib/fixtures";
import { capture } from "../lib/checks";
import { apiAs } from "../lib/api";
import { openAs } from "../lib/session";
import { step } from "../lib/steps";
import { projectName } from "../lib/journey";
import { backupReadingProblems } from "../lib/core.mjs";

const STATES = ["OK", "FAILING", "UNAVAILABLE"];
const SHOWN = ["version", "migrations", "mail"] as const;

type Check = { state: string; reason?: string; completedAt?: string | null; ageSeconds?: number | null };
type Overview = { checkedAt: string; version: Check; migrations: Check; mail: Check; backup: Check };

test.beforeEach(() => { test.skip(!/desktop/.test(projectName()), "the operator health overview is a desk page, read on the desktop browsers"); });

test("given a running instance, when the admin opens the operator health overview, then version, migrations and mail show a state and a backup without evidence never reads as ok", async ({ browser }) => {
  // given
  const page = await openAs(browser, "admin");
  try {
    // when
    await step("admin", "operator health", async () => {
      await page.goto("/admin/operator-health");
      await expect(page.getByTestId("operator-check-backup"), "product: the overview loads its checks").toBeVisible();
      await capture(page, "operator-health");
    });

    // then
    for (const check of SHOWN) {
      const card = page.getByTestId(`operator-check-${check}`);
      await expect(card, `product: the ${check} check is shown`).toBeVisible();
      expect(STATES, `product: the ${check} check carries one of the three states`).toContain(await card.getAttribute("data-state"));
    }
    await expect(page.getByTestId("operator-check-version"), "product: a running instance knows its own version").toHaveAttribute("data-state", "OK");
    await expect(page.getByTestId("operator-check-migrations"), "product: a running instance has applied its migrations").toHaveAttribute("data-state", "OK");

    const answer = await (await apiAs("admin")).get("/api/admin/operator-health");
    expect(answer.status(), "product: the overview answers the administrator").toBe(200);
    const overview = await answer.json() as Overview;
    expect(backupReadingProblems(overview.backup, overview.checkedAt), "product: the backup reading follows from its own evidence").toEqual([]);
    if (overview.backup.reason === "NOT_CONFIGURED") {
      await expect(page.getByTestId("operator-check-backup"), "product: a backup without configured evidence is not read as ok").not.toHaveAttribute("data-state", "OK");
    }
    // The page and the later API call are two readings, so only the backup's state is compared, and only once evidence decides it.
    if (overview.backup.state === "OK" || overview.backup.reason === "NOT_CONFIGURED") {
      await expect(page.getByTestId("operator-check-backup"), "product: the page shows the backup state the API reports").toHaveAttribute("data-state", overview.backup.state);
    }
  } finally {
    await page.context().close();
  }
});
