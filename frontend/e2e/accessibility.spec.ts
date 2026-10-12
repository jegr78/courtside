import AxeBuilder from "@axe-core/playwright";
import { expect, expectAdministrationOverview, selectJourneyDate, selectPreference, test } from "./fixtures";
import { productFailure } from "./browser-diagnostics";
import { routePattern } from "./declared-routes";
import { become, concretePath, PERSONAS, personas, routerPages, settled } from "./page-sweep";
import { STANDARD_RULE_SET } from "./shipped-rows";

// axe tags these best-practice only, so a scan by WCAG tags alone never runs them.
const STRUCTURE_RULES = ["page-has-heading-one", "heading-order", "empty-table-header"];

async function axeFindings(page: import("@playwright/test").Page): Promise<string[]> {
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
async function transitionsSettled(page: import("@playwright/test").Page) {
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

async function expectNoWcagViolations(page: import("@playwright/test").Page) {
  expect(await axeFindings(page), "an axe rule the page breaks").toEqual([]);
}

async function signIn(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expectCourtPlanLoaded(page);
}

async function expectCourtPlanLoaded(page: import("@playwright/test").Page) {
  // A keyboard walk that starts while the plan still renders resumes inside it and laps the footer.
  await expect(page.getByTestId("week-grid")).toBeVisible();
}

type TabWalkPosition = "reached" | "moving" | "lapped" | "trapped";

async function tabToTestId(page: import("@playwright/test").Page, testId: string, key = "Tab") {
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

test("account preferences open from the keyboard and remain accessible", async ({ page }) => {
  // given
  await page.goto("/");
  await page.getByTestId("preferences-menu").focus();

  // when
  await page.keyboard.press("Enter");

  // then
  await expect(page.locator("#locale-preference")).toBeVisible();
  await expect(page.locator("#theme-preference")).toBeVisible();
  await expectNoWcagViolations(page);
});

for (const locale of ["de", "en"]) {
  test(`${locale} public and login views meet automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await selectPreference(page, "#locale-preference", locale);

    // when / then
    await expectNoWcagViolations(page);
    await page.getByTestId("sign-in-link").click();
    await expectNoWcagViolations(page);

  });

  test(`${locale} court plan and booking dialog meet automated WCAG 2.2 AA checks`, async ({ page, journeyService }) => {
    // given
    await page.goto("/");
    await selectPreference(page, "#locale-preference", locale);
    await signIn(page, "doe.jane");

    // when / then
    const pageHeading = page.getByRole("heading", { level: 1 });
    await expect(pageHeading).toBeVisible();
    await expect(pageHeading).toHaveText(locale === "de" ? "Platzplan" : "Court plan");
    await expectNoWcagViolations(page);
    await selectJourneyDate(page, journeyService.visualDate);
    await page.locator('[data-testid="free-slot"][data-state="free"]').first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoWcagViolations(page);
  });

  test(`${locale} bookings view meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await selectPreference(page, "#locale-preference", locale);
    await signIn(page, "doe.jane");

    // when
    await page.getByTestId("my-bookings-link").click();
    await expect(page.getByTestId("my-bookings-page")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} messages view meets automated WCAG 2.2 AA checks`, async ({ page, journeyService }) => {
    // given
    const unread = "7c000000-0000-0000-0000-0000000000a1";
    const read = "7c000000-0000-0000-0000-0000000000a2";
    await journeyService.executeSql(`
      INSERT INTO notification (id, account_id, kind, parameters, created_at, read_at) VALUES
        ('${unread}', '00000000-0000-0000-0000-000000000102', 'BOOKING_DISPLACED', '{"closure": "DAY_CLOSED"}', now(), NULL),
        ('${read}', '00000000-0000-0000-0000-000000000102', 'ACCOUNT_USERNAME_REMINDER', '{}', now(), now());`);
    try {
      await page.goto("/");
      await selectPreference(page, "#locale-preference", locale);
      await signIn(page, "doe.jane");

      // when
      await page.getByTestId("my-messages-link").click();
      await expect(page.getByTestId(`notification-${unread}`)).toBeVisible();
      await expect(page.getByTestId(`notification-${read}`)).toHaveAttribute("data-read", "true");

      // then
      await expectNoWcagViolations(page);
    } finally {
      await journeyService.executeSql(`DELETE FROM notification WHERE id IN ('${unread}', '${read}');`);
    }
  });

  test(`${locale} the series form meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await selectPreference(page, "#locale-preference", locale);
    await signIn(page, "sport.major");
    await page.getByTestId("administration-link").click();
    await expect(page.getByTestId("managed-appointments-page")).toBeVisible();

    // when
    await page.getByTestId("new-series").click();
    await expect(page.getByTestId("series-courts")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} the cancel dialog for somebody else's appointment with its reason meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await selectPreference(page, "#locale-preference", locale);
    await signIn(page, "sport.major");
    await page.getByTestId("administration-link").click();
    await expect(page.getByTestId("managed-appointments-page")).toBeVisible({ timeout: 10_000 });
    const appointment = page.getByTestId("booking-70000000-0000-0000-0000-000000000004");

    // when
    await appointment.getByTestId("managed-actions").click();
    await appointment.getByTestId("managed-cancel").click();
    await expect(page.getByTestId("cancellation-reason")).toBeVisible({ timeout: 10_000 });

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} the waitlist dialog for a taken court meets automated WCAG 2.2 AA checks`, async ({ page, journeyService }) => {
    // given
    await page.goto("/");
    await selectPreference(page, "#locale-preference", locale);
    await signIn(page, "doe.jane");
    await selectJourneyDate(page, journeyService.visualDate);

    // when
    await page.locator('button[data-testid="allocation"][data-booking-id="70000000-0000-0000-0000-000000000002"]').click();
    await expect(page.getByTestId("waitlist-explanation")).toBeVisible({ timeout: 10_000 });

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} setup and administration configuration meet automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await selectPreference(page, "#locale-preference", locale);
    await signIn(page, "configuration-admin");

    // when
    await page.goto("/admin");
    await expectAdministrationOverview(page);

    // then
    await expectNoWcagViolations(page);

    // when
    await page.goto("/admin/setup");
    await expect(page.getByTestId("setup-progress")).toBeVisible();

    // then
    await expectNoWcagViolations(page);

    // when
    await page.getByTestId("admin-configuration-link").click();
    await expect(page.getByTestId("admin-configuration-view")).toBeVisible();
    await expect(page.getByTestId("logo-url")).toBeEnabled();

    // then
    await expectNoWcagViolations(page);

    // when — the save bar is only on screen once something is unsaved
    await page.getByTestId("club-name").fill("Example Racquet Club");
    await expect(page.getByTestId("save-bar")).toBeVisible();

    // then
    await expectNoWcagViolations(page);

    // when
    await page.getByTestId("discard-club-configuration").click();
    await expect(page.getByTestId("save-bar")).toHaveCount(0);
    await page.getByTestId("admin-deadlines-link").click();
    await expect(page.getByTestId("booking-reminder-hours")).toBeEnabled();

    // then
    await expectNoWcagViolations(page);

    // when
    await page.getByTestId("admin-rule-sets-link").click();
    await expect(page.getByTestId("rule-set-overview")).toBeVisible();
    await expect(page.getByTestId("rule-set-name")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} court and opening-hours administration meet automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await selectPreference(page, "#locale-preference", locale);
    await signIn(page, "configuration-admin");

    // when
    await page.goto("/admin/facility/courts");
    await expect(page.getByTestId("admin-courts-view")).toBeVisible();
    await expect(page.getByTestId("create-court")).toBeVisible();

    // then
    await expectNoWcagViolations(page);

    // when — an edited court brings the save bar, which is only on screen once something is unsaved
    await page.getByTestId("edit-court-name-dddddddd-0000-0000-0000-000000000002").fill("Practice Wall");
    await expect(page.getByTestId("save-bar")).toBeVisible();

    // then
    await expectNoWcagViolations(page);

    // when
    await page.getByTestId("discard-courts").click();
    await expect(page.getByTestId("save-bar")).toHaveCount(0);
    await page.goto("/admin/facility/opening-hours");
    await expect(page.getByTestId("hours-open-MONDAY")).toBeEnabled();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} card administration meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await selectPreference(page, "#locale-preference", locale);
    await signIn(page, "configuration-admin");

    // when
    await page.goto("/admin/facility/booking-cards");
    await expect(page.getByTestId("create-card")).toBeVisible();

    // then
    await expectNoWcagViolations(page);

    // when
    await page.getByTestId(/^card-link-/).first().click();
    await expect(page.getByTestId("card-preview")).toBeVisible();

    // then
    await expectNoWcagViolations(page);

    // when
    await page.goto("/admin/facility/slot-fillers");
    await expect(page.getByTestId("create-participant-card")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} audit administration meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await selectPreference(page, "#locale-preference", locale);
    await signIn(page, "configuration-admin");
    await page.goto("/admin/facility/courts");
    await expect(page.getByTestId("admin-courts-view")).toBeVisible();
    const courtToggled = page.waitForResponse((response) =>
      response.url().endsWith("/api/admin/courts/dddddddd-0000-0000-0000-000000000002/active")
        && response.request().method() === "PUT"
    );
    await page.getByTestId("toggle-court-dddddddd-0000-0000-0000-000000000002").click();
    await courtToggled;

    // when
    await page.goto("/admin/audit");
    await expect(page.getByTestId("admin-audit-view")).toBeVisible();
    await expect(page.getByTestId("audit-row").first()).toBeVisible();

    // then
    await expectNoWcagViolations(page);

    // when
    await page.goto("/admin/operational-logs");
    await expect(page.getByTestId("admin-operational-logs-view")).toBeVisible();
    await expect(page.getByTestId("operational-logs-unavailable")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} roster administration meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await selectPreference(page, "#locale-preference", locale);
    await signIn(page, "configuration-admin");

    // when
    await page.goto("/admin/roster");
    await expect(page.getByTestId("admin-roster-view")).toBeVisible();
    await expect(page.getByTestId("create-person")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} one person's administration meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await selectPreference(page, "#locale-preference", locale);
    await signIn(page, "configuration-admin");
    await page.goto("/admin/roster");
    await expect(page.getByTestId("create-person")).toBeVisible();

    // when — the page a board spends its time on, with every control a person can carry
    await page.locator('[data-testid^="person-link-"]').first().click();
    await expect(page.getByTestId("admin-person-view")).toBeVisible();
    await expect(page.getByTestId("export-person-data")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} membership type administration meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await selectPreference(page, "#locale-preference", locale);
    await signIn(page, "configuration-admin");

    // when
    await page.goto("/admin/membership-types");
    await expect(page.getByTestId("admin-membership-types-view")).toBeVisible();
    await expect(page.getByTestId("create-membership-type")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} import administration meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await selectPreference(page, "#locale-preference", locale);
    await signIn(page, "configuration-admin");

    // when
    await page.goto("/admin/import");
    await expect(page.getByTestId("no-sources")).toBeVisible();
    await page.getByTestId("new-source").click();
    await expect(page.getByTestId("column-EXTERNAL_ID")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} message log administration meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await selectPreference(page, "#locale-preference", locale);
    await signIn(page, "configuration-admin");

    // when — empty, because the control this view adds is the filter and it is on screen either
    // way; the table's own markup is the shape the roster and the audit table are checked with
    await page.goto("/admin/messages");
    await expect(page.getByTestId("messages-empty")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} a filled message log meets automated WCAG 2.2 AA checks as a table and as phone cards`, async ({ page, journeyService }) => {
    // given
    const record = "7c000000-0000-0000-0000-0000000000d2";
    await journeyService.executeSql(`
      INSERT INTO message_record (id, account_id, kind, state, message_id, reason, status_code, queued_at, settled_at)
      VALUES ('${record}', '00000000-0000-0000-0000-000000000102', 'CREDENTIALS_NEW_ACCOUNT', 'REFUSED',
        '<0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.1759349460000@relay.example.org>', 'SendFailedException', '550',
        now(), now());`);
    try {
      await page.goto("/");
      await selectPreference(page, "#locale-preference", locale);
      await signIn(page, "configuration-admin");
      await expect(page.getByTestId("administration-link"), "the board is signed in").toBeVisible({ timeout: 10_000 });

      // when
      await page.goto("/admin/messages");
      const entry = page.locator(`[data-testid="message-row"][data-entry-id="${record}"]`);
      await expect(entry, "the seeded message is listed").toBeVisible({ timeout: 10_000 });

      // then
      await expectNoWcagViolations(page);

      // when
      await page.setViewportSize({ width: 393, height: 852 });

      // then
      await expect(entry, "the message is a card at phone width").toHaveCSS("display", "grid", { timeout: 10_000 });
      await expectNoWcagViolations(page);
    } finally {
      await journeyService.executeSql(`DELETE FROM message_record WHERE id = '${record}';`);
    }
  });
}

const operationalLogPage = {
  availability: "AVAILABLE",
  retentionTruncated: false,
  searchIncomplete: false,
  droppedRecords: 0,
  entries: [1, 2, 3].map((index) => ({
    id: `7d000000-0000-0000-0000-00000000000${index}`,
    occurredAt: `2030-03-11T0${index}:00:00Z`,
    source: "APPLICATION",
    severity: "WARN",
    message: "Mail relay relay.example.org refused the connection on port 587 and the message stays queued",
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736"
  }))
};

// The tables that scroll sideways on a phone, which the sweep must see rendered to judge them.
const awaitedContent: Record<string, string[]> = {
  "/admin/utilisation": ["statistics-hours-scroll", "statistics-messages-scroll"],
  "/admin/operational-logs": ["operational-logs-scroll"]
};

// A page whose content only appears after a step, so the sweep scans that state as well.
const furtherStates: Record<string, (page: import("@playwright/test").Page) => Promise<void>> = {
  "/admin/appointments": async (page) => {
    await page.getByTestId("new-series").click();
    await expect(page.getByTestId("series-form"), "the series form opens").toBeVisible({ timeout: 10_000 });
  }
};

async function standInsForEmptyTables(page: import("@playwright/test").Page) {
  await page.route("**/api/admin/operational-logs/search", (route) => route.fulfill({ json: operationalLogPage }));
  await page.route("**/api/admin/statistics/messages**", async (route) => {
    const asked = new URL(route.request().url()).searchParams;
    await route.fulfill({ json: {
      period: { from: asked.get("from") ?? "2030-02-01", to: asked.get("to") ?? "2030-02-28", timeZone: "Europe/Berlin" },
      kinds: ["BOOKING_CONFIRMED", "BOOKING_REMINDER"].map((kind) => ({ kind, queued: 1, handedOver: 12, refused: 2, failed: 1, retried: 3 })),
      previous: null
    } });
  });
}

const sweptSides = [
  { side: "member", board: false },
  { side: "board", board: true }
];
const sweptWidths = [
  { device: "desk", viewport: { width: 1280, height: 720 } },
  { device: "phone", viewport: { width: 393, height: 852 } }
];

test.describe("every page", () => {
  // WebKit routes no request a service worker makes, so the stand-ins would be bypassed.
  test.use({ serviceWorkers: "block" });

  for (const { side, board } of sweptSides) {
    for (const { device, viewport } of sweptWidths) {
      test(`given a ${device}, when every ${side} page is opened in both themes, then axe finds nothing`, async ({ page }) => {
        // given
        await standInsForEmptyTables(page);
        await page.setViewportSize(viewport);
        const pages = routerPages().filter((route) => route.path.startsWith("/admin") === board);
        const landed = new Set<string>();
        const unresolved: string[] = [];
        const findings: string[] = [];
        const html = page.locator("html");
        const scanInBothThemes = async (where: string) => {
          for (const pass of [1, 2]) {
            const theme = await html.getAttribute("data-theme");
            await transitionsSettled(page);
            findings.push(...(await axeFindings(page)).map((finding) => `${where} in ${theme}: ${finding}`));
            if (pass === 2) break;
            const other = theme === "dark" ? "light" : "dark";
            await selectPreference(page, "#theme-preference", other);
            await expect(html, "the page switches to the other theme").toHaveAttribute("data-theme", other, { timeout: 10_000 });
          }
        };

        // when
        for (const persona of PERSONAS) {
          const paths = pages.filter((route) => personas(route.path).includes(persona)).map((route) => route.path);
          if (paths.length === 0) continue;
          await become(page, persona);
          for (const path of paths) {
            const concrete = await concretePath(page, path);
            if (concrete === undefined) {
              unresolved.push(`${path} as ${persona}`);
              continue;
            }
            await page.goto(concrete);
            await settled(page);
            expect(await page.evaluate(() => navigator.serviceWorker.controller === null), "no service worker answers in place of the stand-ins").toBe(true);
            const at = new URL(page.url()).pathname;
            landed.add(at);
            for (const testId of awaitedContent[at] ?? []) {
              await expect(page.getByTestId(testId), `${at} shows its wide table ${testId}`).toBeVisible({ timeout: 10_000 });
            }
            await scanInBothThemes(`${at} as ${persona}`);
            const further = furtherStates[at];
            if (further) {
              await further(page);
              await scanInBothThemes(`${at} further as ${persona}`);
            }
          }
        }

        // then
        const missed = pages.filter((route) => !route.redirect && ![...landed].some((path) => routePattern(route.path).test(path)));
        expect.soft(unresolved, "a parameter route whose list page links to no instance").toEqual([]);
        expect.soft(missed.map((route) => route.path), "a page the sweep never reached").toEqual([]);
        expect(findings, "an axe rule a page breaks").toEqual([]);
      });
    }
  }
});


test("initial password and validation states meet automated WCAG 2.2 AA checks", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("bootstrap-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("initial-password-view")).toBeVisible();

  // when / then
  await expectNoWcagViolations(page);
  await page.getByTestId("new-password").fill("first-password");
  await page.getByTestId("confirm-password").fill("second-password");
  await page.getByTestId("password-submit").click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expectNoWcagViolations(page);
});

test("initial password change is operable using only the keyboard", async ({ page, browserName }) => {
  // given
  await page.goto("/login");
  const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await page.getByTestId("username").focus();
  await page.keyboard.type("bootstrap-admin");
  await page.keyboard.press(tabKey);
  await page.keyboard.type("temporary-password");
  await tabToTestId(page, "login-submit", tabKey);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("initial-password-view")).toBeVisible();

  // when
  await tabToTestId(page, "new-password", tabKey);
  await page.keyboard.type("permanent-password");
  await tabToTestId(page, "new-password-visibility", tabKey);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("new-password")).toHaveAttribute("type", "text");
  await expect(page.getByTestId("new-password")).toHaveValue("permanent-password");
  await tabToTestId(page, "confirm-password", tabKey);
  await page.keyboard.type("permanent-password");
  await tabToTestId(page, "password-submit", tabKey);
  await page.keyboard.press("Enter");

  // then
  await expect(page.getByTestId("login-view")).toBeVisible();
});

test("booking dialog traps focus in both directions and restores its trigger", async ({ page, journeyService }) => {
  // given
  await signIn(page, "doe.jane");
  await selectJourneyDate(page, journeyService.visualDate);
  const trigger = page.locator('[data-testid="free-slot"][data-state="free"]').first();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("booking-submit")).toBeEnabled();
  const focusable = dialog.locator('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
  const first = focusable.first();
  const last = focusable.last();

  // when / then
  await expect(first).toBeFocused();
  await first.press("Shift+Tab");
  await expect(last).toBeFocused();
  await last.press("Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("a booking is operable using only the keyboard", async ({ page, browserName, journeyService }) => {
  // given
  await signIn(page, "doe.jane");
  const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await selectJourneyDate(page, journeyService.visualDate);
  await page.getByTestId("court-plan-link").focus();
  await tabToTestId(page, "free-slot", tabKey);
  const bookingsBefore = await page.getByTestId("own-allocation").count();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();

  // when
  await tabToTestId(page, "member-search", tabKey);
  await page.keyboard.type("Mary");
  await expect(page.getByTestId("member-match")).toBeVisible();
  await tabToTestId(page, "member-match", tabKey);
  await page.keyboard.press("Enter");
  await tabToTestId(page, "booking-submit", tabKey);
  await page.keyboard.press("Enter");

  // then
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByTestId("own-allocation")).toHaveCount(bookingsBefore + 1);
});

test("joining the waitlist of a taken court is operable using only the keyboard", async ({ page, browserName, journeyService }) => {
  // given
  await signIn(page, "doe.jane");
  const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await selectJourneyDate(page, journeyService.visualDate);
  await page.getByTestId("court-plan-link").focus();
  await tabToTestId(page, "allocation", tabKey);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("waitlist-explanation")).toBeVisible({ timeout: 10_000 });

  // when
  await tabToTestId(page, "member-search", tabKey);
  await page.keyboard.type("Mary");
  await expect(page.getByTestId("member-match")).toBeVisible({ timeout: 10_000 });
  await tabToTestId(page, "member-match", tabKey);
  await page.keyboard.press("Enter");
  await tabToTestId(page, "booking-close", tabKey);
  await page.keyboard.press("Enter");

  // then
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("allocation").first()).toBeFocused({ timeout: 10_000 });
});

test("login and cancellation are operable using only the keyboard", async ({ page, browserName }) => {
  // given
  await page.goto("/login");

  // when
  await expect(page.getByTestId("username")).toBeFocused();
  await page.keyboard.type("doe.jane");
  await page.keyboard.press("Tab");
  await page.keyboard.type("temporary-password");
  const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await tabToTestId(page, "login-submit", tabKey);
  await page.keyboard.press("Enter");

  // then
  await expectCourtPlanLoaded(page);
  await tabToTestId(page, "my-bookings-link", tabKey);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();
  await tabToTestId(page, "personal-cancel", tabKey);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").locator(":focus")).toHaveCount(1);
  await tabToTestId(page, "confirm-cancellation", tabKey);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("series management is operable using only the keyboard", async ({ page, browserName }) => {
  // given
  await signIn(page, "doe.jane");
  const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await tabToTestId(page, "my-bookings-link", tabKey);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();

  // when
  await tabToTestId(page, "move-booking", tabKey);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await tabToTestId(page, "move-duration", tabKey);
  await page.keyboard.type("90");
  await tabToTestId(page, "preview-move", tabKey);
  await page.keyboard.press("Enter");

  // then
  await expect(page.getByTestId("move-preview")).toBeVisible();
});

test("core administration is operable using only the keyboard", async ({ page, browserName }) => {
  // given
  await signIn(page, "configuration-admin");
  await page.goto("/admin/configuration");
  await expect(page.getByTestId("admin-configuration-view")).toBeVisible();
  await expect(page.getByTestId("club-name")).toHaveValue("Courtside");
  await page.evaluate(() => {
    const nativeFetch = window.fetch.bind(window);
    const observed = window as typeof window & { configurationWrites: number };
    observed.configurationWrites = 0;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/admin/config") && init?.method === "PUT") {
        observed.configurationWrites += 1;
        if (observed.configurationWrites === 1) {
          const name = location.protocol === "https:" ? "__Host-XSRF-TOKEN" : "XSRF-TOKEN";
          const token = document.cookie.split("; ").find((entry) => entry.startsWith(`${name}=`));
          if (!token) throw new Error("The signed-in browser has no CSRF cookie to rotate");
          const secure = location.protocol === "https:" ? "; Secure" : "";
          document.cookie = `${token}-rotated; Path=/; SameSite=Lax${secure}`;
        }
      }
      return nativeFetch(input, init);
    };
  });

  // when
  const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await tabToTestId(page, "club-name", tabKey);
  await page.keyboard.press("End");
  await page.keyboard.type(" Club");
  await tabToTestId(page, "save-club-config", tabKey);
  const refused = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/config")
      && response.request().method() === "PUT"
      && response.status() === 403
  );
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/config")
      && response.request().method() === "PUT"
      && response.status() === 200
  );
  await page.keyboard.press("Enter");

  // then
  const [refusal, completedSave] = await Promise.all([refused, saved]);
  expect(refusal.status()).toBe(403);
  expect(completedSave.status()).toBe(200);
  expect(await page.evaluate(() =>
    (window as typeof window & { configurationWrites: number }).configurationWrites
  )).toBe(2);
  await expect(page.getByTestId("admin-save-success")).toBeVisible();
});

test("a rule set is chosen from the overview using only the keyboard", async ({ page, browserName }) => {
  // given
  await signIn(page, "configuration-admin");
  await page.goto("/admin/rule-sets");
  const standard = page.getByTestId(`rule-set-choose-${STANDARD_RULE_SET}`);
  await expect(page.getByTestId("rule-set-overview")).toBeVisible();
  await page.getByTestId("new-rule-set-name").fill("Example junior rules");
  await page.getByTestId("create-rule-set").click();
  await expect(standard).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("admin-rule-sets-link").focus();

  // when
  await tabToTestId(page, `rule-set-choose-${STANDARD_RULE_SET}`, browserName === "webkit" ? "Alt+Tab" : "Tab");
  await page.keyboard.press("Enter");

  // then
  await expect(standard).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("rule-set-name")).not.toHaveValue("Example junior rules");
});

test("the core layout reflows at the 400 percent zoom equivalent", async ({ page }) => {
  // given
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect(page.getByTestId("court-plan-view")).toBeVisible();

  // when
  await page.setViewportSize({ width: 320, height: 720 });
  await page.evaluate(() => document.fonts.ready);

  // then
  await expect(async () => {
    const layout = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      fonts: document.fonts.status,
      reflowed: window.matchMedia("(max-width: 640px)").matches
    }));
    // A face still loading renders in a fallback whose metrics are not the layout under test.
    expect(layout.fonts).toBe("loaded");
    expect(layout.reflowed).toBe(true);
    expect(layout.content).toBeLessThanOrEqual(layout.viewport);
  }).toPass();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
});

test("reduced motion and forced colours preserve the core controls", async ({ page }) => {
  // given
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });

  // when
  await page.goto("/");

  // then
  await expect(page.getByTestId("week-next")).toBeVisible();
  const transitionDuration = await page.getByTestId("week-next").evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).transitionDuration));
  expect(transitionDuration).toBeLessThanOrEqual(0.001);
  await page.getByTestId("week-next").focus();
  await expect(page.getByTestId("week-next")).toBeFocused();
});
