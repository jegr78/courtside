import { expect, expectAdministrationOverview, selectJourneyDate, selectPreference, test } from "./fixtures";
import { expectNoWcagViolations, signIn } from "./accessibility-checks";

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
