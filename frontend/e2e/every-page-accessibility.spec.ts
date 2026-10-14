import { expect, selectJourneyDate, selectPreference, test } from "./fixtures";
import { routePattern } from "./declared-routes";
import { become, concretePath, PERSONAS, personas, routerPages, settled } from "./page-sweep";
import { STANDARD_RULE_SET } from "./shipped-rows";
import { axeFindings, expectCourtPlanLoaded, expectNoWcagViolations, signIn, tabToTestId, transitionsSettled } from "./accessibility-checks";

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

// Content that only appears once its data has loaded, which the sweep must see rendered to judge it.
const awaitedContent: Record<string, string[]> = {
  "/admin/utilisation": ["statistics-hours-scroll", "statistics-messages-scroll"],
  "/admin/operational-logs": ["operational-logs-scroll"],
  "/admin/appointments": ["managed-single-appointments"]
};

// A page whose content only appears after a step, so the sweep scans that state as well.
const furtherStates: Record<string, (page: import("@playwright/test").Page) => Promise<void>> = {
  "/admin/appointments": async (page) => {
    await page.getByTestId("new-series").click();
    await expect(page.getByTestId("series-form"), "the series form opens").toBeVisible({ timeout: 10_000 });
  }
};

const appointment = (index: number, seriesId: string | null) => ({
  id: `7e000000-0000-0000-0000-00000000000${index}`, cardId: "7e000000-0000-0000-0000-0000000000c1", courtIds: [],
  startsAt: `2030-03-1${index}T16:00:00Z`, endsAt: `2030-03-1${index}T17:00:00Z`, cardLabel: "Training", cardColor: "#34584a",
  status: "CONFIRMED", participantCount: 4, seriesId, ownBooking: true
});

// Single appointments between and after two series, the list shape that repeated a landmark.
const managedAppointmentsPage = {
  items: [appointment(1, "series-a"), appointment(2, null), appointment(3, "series-b"), appointment(4, null)]
};

async function standInsForEmptyTables(page: import("@playwright/test").Page) {
  await page.route("**/api/managed/bookings?**", (route) => route.fulfill({ json: managedAppointmentsPage }));
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
              await expect(page.getByTestId(testId).first(), `${at} shows ${testId}`).toBeVisible({ timeout: 10_000 });
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
