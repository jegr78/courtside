import { fileURLToPath } from "node:url";
import { type Locator, type Page } from "@playwright/test";
import { accessGrantsExample, connectionCheckExample, operationalLogExample, operatorHealthExample } from "./admin-examples";
import { backAtTheJourneyInstant, expect, expectAdministrationOverview, onTheVisualDay, routeLongSeries, selectJourneyDate, selectPreference, seriesBookingId, test } from "./fixtures";
import { journeyInstant } from "./global-setup";

// Locale, theme, viewport and timezone are fixed here; the renderer is fixed by the project,
// which draws in the pinned image rather than in whatever browser the host provides.
test.use({
  viewport: { width: 1440, height: 1000 }, colorScheme: "dark", locale: "de-DE",
  timezoneId: "Europe/Berlin"
});

const screenshotOptions = {
  animations: "disabled" as const,
  caret: "hide" as const
};

test("stable member surfaces match their reviewed baselines", async ({ page, journeyService }) => {
  // given
  await page.goto("/");
  await expect(page.getByTestId("guest-guidance")).toBeVisible();
  await selectVisualDate(page, journeyService.visualDate);

  // then
  await stableScreenshot(page.getByTestId("court-plan-view"), "court-plan.png");

  // when
  await signIn(page, "doe.jane");
  await selectVisualDate(page, journeyService.visualDate);
  await expect(page.getByTestId("own-allocation").first()).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("court-plan-view"), "court-plan-member.png");

  // when
  await page.locator('button[data-testid="allocation"]').first().click();
  await expect(page.getByTestId("waitlist-explanation")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));

  // then
  await stableScreenshot(page.getByTestId("booking-dialog"), "waitlist-dialog.png");
  await page.getByTestId("booking-close").click();
  await expect(page.getByTestId("booking-dialog")).toHaveCount(0);

  // when
  const slot = page.locator('[data-testid="free-slot"][data-court-number="1"][data-slot="12:00"]');
  await slot.click();
  await expect(page.getByTestId("booking-dialog")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));

  // then
  // The dialog carries no dynamic content of its own - the journey date and slot are pinned - so
  // masking the day strip behind it would only hide the controls this baseline exists to guard.
  await stableScreenshot(page.getByTestId("booking-dialog"), "booking-dialog.png");

  // when
  await page.getByTestId("booking-submit").click();
  await expect(page.getByTestId("booking-dialog").locator("[data-code]")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("booking-dialog"), "booking-validation.png",
    page.getByTestId("booking-outcome").getByRole("alert"));

  // when
  await page.getByTestId("booking-close").click();
  await page.getByTestId("my-bookings-link").click();
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();
  await expect(page.getByTestId("upcoming-bookings")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("my-bookings-page"), "personal-bookings.png", page.locator("time"));

  // when
  await page.locator(`[data-testid="personal-cancel"][data-booking-id="${seriesBookingId}"]`).click();
  await expect(page.getByRole("dialog").getByTestId("confirm-cancellation")).toBeVisible();

  // then
  await stableScreenshot(page.getByRole("dialog"), "cancel-dialog.png");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  // when
  await page.getByTestId("my-messages-link").click();
  await expect(page.getByTestId("my-messages-view")).toBeVisible();
  await expect(page.getByTestId("notifications-show-unread")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("my-messages-view"), "my-messages.png");

  // when
  await page.getByTestId("message-choice-BOOKING_REMINDER").click();
  await page.getByTestId("my-messages-save").click();
  await expect(page.getByTestId("my-messages-saved")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("my-messages-view"), "my-messages-saved.png");

  // when
  await page.getByTestId("my-bookings-link").click();
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();

  // when
  await page.getByTestId("move-booking").click();
  await page.getByTestId("move-start-time").fill("11:00");
  await page.getByTestId("preview-move").click();
  await expect(page.getByTestId("move-preview")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("move-dialog"), "series-preview.png",
    page.getByTestId("move-preview").locator("li p"));
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("move-dialog")).toBeHidden();

  // when
  await page.getByTestId("preferences-menu").click();
  await expect(page.locator("#theme-preference")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("preferences-body").locator(".."), "preferences-menu.png");

  // when
  await page.getByTestId("account-link").click();
  await expect(page.getByTestId("account-profile")).toBeVisible();
  await expect(page.getByTestId("current-password")).toBeVisible();

  // then
  // A session carries the server's wall-clock time, which the fixed journey clock does not reach.
  await stableScreenshot(page.getByTestId("account-view"), "account.png", page.locator('[id^="account-session-"] > div'));
});

test("given a visitor, when a sign-in is refused and a password reset is requested, then each step matches its reviewed baseline", async ({ page }) => {
  // given
  await page.goto("/login");
  await expect(page.getByTestId("login-submit")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("login-view"), "login.png");

  // when
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("not-the-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-view").getByRole("alert")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("login-view"), "login-refused.png");

  // when
  await page.getByTestId("forgotten-credentials-link").click();
  await expect(page.getByTestId("recovery-password-submit")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("account-recovery-view"), "account-recovery.png");

  // when
  await page.getByTestId("recovery-username").fill("doe.jane");
  await page.getByTestId("recovery-password-submit").click();
  await expect(page.getByTestId("recovery-sent")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("account-recovery-view"), "account-recovery-sent.png");
});

test("given an open place and a waitlist offer, when another member reads their bookings, then both sections match their reviewed baselines", async ({ page, journeyService }) => {
  // given
  await journeyService.executeSql(`
    INSERT INTO waitlist_entry (id, account_id, court_id, card_id, starts_at, ends_at, state, joined_at, offered_at, offer_expires_at)
    VALUES ('7e000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000116', 'dddddddd-0000-0000-0000-000000000003',
      '11111111-1111-1111-1111-111111111111', (DATE '${journeyService.visualDate}' + TIME '17:00') AT TIME ZONE 'Europe/Berlin',
      (DATE '${journeyService.visualDate}' + TIME '18:00') AT TIME ZONE 'Europe/Berlin', 'OFFERED',
      TIMESTAMPTZ '${journeyInstant}' - INTERVAL '1 hour', TIMESTAMPTZ '${journeyInstant}', TIMESTAMPTZ '${journeyInstant}' + INTERVAL '15 minutes');`);
  await signIn(page, "doe.jane");
  await selectVisualDate(page, journeyService.visualDate);
  await page.locator('[data-testid="free-slot"][data-court-number="1"][data-slot="15:00"]').click();
  await expect(page.getByTestId("booking-dialog")).toBeVisible();
  await page.getByTestId("booking-more-summary").click();
  await page.getByTestId("participant-card").first().selectOption("66666666-6666-6666-6666-666666666666");
  await page.getByTestId("booking-submit").click();
  await expect(page.getByTestId("booking-dialog")).toHaveCount(0);
  await page.getByTestId("my-bookings-link").click();
  await page.getByTestId("publish-open-place").first().click();
  await expect(page.getByTestId("withdraw-open-place").first()).toBeVisible();
  await page.getByTestId("my-messages-link").click();
  await expect(async () => {
    await page.reload();
    await page.getByTestId("notifications-show-unread").click({ timeout: 2_000 });
    await expect(page.locator('[data-testid="notifications"] > li').first()).toBeVisible({ timeout: 2_000 });
  }, "the booking confirmation reaches the notification list").toPass({ timeout: 30_000 });

  // then
  await stableScreenshot(page.getByTestId("my-messages-view"), "my-messages-notification.png");
  await signOut(page);

  // when
  await signIn(page, "roe.jane");
  await page.getByTestId("my-bookings-link").click();
  await expect(page.getByTestId("take-open-place")).toBeVisible();
  await expect(page.getByTestId("waitlist-accept")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("open-places"), "open-places.png");
  await stableScreenshot(page.getByTestId("waitlist-entries"), "waitlist-offered.png");
});

test("given a guardian of a member, when the guardian and the board read the relationship, then both pages match their reviewed baselines", async ({ page, journeyService }) => {
  // given
  const relationship = "7f000000-0000-0000-0000-000000000001";
  await journeyService.executeSql(`
    INSERT INTO guardian_relationship (id, guardian_person_id, dependant_person_id, started_on)
    VALUES ('${relationship}', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000115', DATE '2026-05-01');
    INSERT INTO guardian_relationship_action (guardian_relationship_id, action)
    SELECT '${relationship}', unnest(ARRAY['VIEW_BOOKINGS', 'BOOK', 'CANCEL_BOOKINGS', 'READ_MESSAGES']);`);
  await signIn(page, "doe.jane");

  // when
  await page.goto("/my-dependants");
  await expect(page.getByTestId("dependant-booking-list")).toBeVisible();
  await expect(page.getByTestId("dependant-notifications-show-unread")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("dependants-view"), "dependants.png");

  // when
  await signOut(page);
  await signIn(page, "configuration-admin");
  await page.goto("/admin/roster/00000000-0000-0000-0000-000000000101");
  await expect(page.getByTestId("guardianships-list")).toBeVisible();
  await expect(page.getByTestId("no-shows-none").or(page.getByTestId("no-shows-list"))).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-person-view"), "admin-person.png");
});

test("given a member list without a header row, when the board previews it and then a file that lost a column, then the preview and its refusal match their reviewed baselines", async ({ page }) => {
  // given
  const rows = [["9001", "Jane", "Doe", "active"], ["9002", "John", "Roe", "active"], ["9003", "Mary", "Major", "active"]];
  const file = (name: string, lines: string[][]) => ({ name, mimeType: "text/csv", buffer: Buffer.from(lines.map((line) => line.join(";")).join("\n") + "\n") });
  await signIn(page, "configuration-admin");
  await page.goto("/admin/import");
  await page.getByTestId("new-source").click();
  await page.getByTestId("column-mode-POSITION").check();
  await page.getByTestId("source-file").setInputFiles(file("members.csv", rows));
  await expect(page.getByTestId("sample-column-4")).toBeVisible();
  await page.getByTestId("source-key").fill("club-registry");
  await page.getByTestId("source-name").fill("Club registry");
  for (const [index, field] of ["EXTERNAL_ID", "FIRST_NAME", "LAST_NAME"].entries()) {
    await page.getByTestId(`position-${field}`).selectOption(String(index + 1));
  }
  await page.getByTestId("source-default-type").selectOption("cccccccc-0000-0000-0000-000000000001");
  await page.getByTestId("save-source").click();
  await expect(page.getByTestId("snapshot-file")).toBeVisible();

  // when
  await page.getByTestId("snapshot-mode").selectOption("UPDATE_ONLY");
  await page.getByTestId("snapshot-file").setInputFiles(file("members.csv", rows));
  await page.getByTestId("upload-snapshot").click();
  await expect(page.getByTestId("preview-identity")).toBeVisible();
  await page.getByTestId("changes-heading").click();
  await expect(page.getByTestId("change-CREATE-9003")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("import-part-preview"), "admin-import-preview.png");

  // when
  await page.getByTestId("snapshot-file").setInputFiles(file("members-truncated.csv", rows.map((row) => row.slice(0, 3))));
  await page.getByTestId("upload-snapshot").click();
  await expect(page.getByTestId("import-part-preview").getByRole("alert")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("import-part-preview"), "admin-import-refused.png");
});

test("the phone court plan and personal bookings match their reviewed baselines", async ({ page, journeyService }) => {
  // given
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("guest-guidance")).toBeVisible();
  await selectJourneyDate(page, journeyService.visualDate);

  // then
  await atPageTop(page);
  await phoneScreenshot(page.getByTestId("court-plan-view"), "phone-public-court-plan.png");

  // when
  await signIn(page, "doe.jane");
  await page.getByTestId("my-bookings-link").click();
  await expect(page.getByTestId("upcoming-bookings")).toBeVisible();

  // then
  await phoneScreenshot(page.getByTestId("my-bookings-page"), "phone-personal-bookings.png", page.locator("time"));
});

for (const theme of ["dark", "light"] as const) {
  const baseline = (surface: string) => theme === "dark" ? `${surface}.png` : `${surface}-light.png`;
  const capture = async (surface: Locator, name: string, mask?: Locator) => {
    await expect(surface.page().locator("html"), `the capture is drawn in the ${theme} theme`).toHaveAttribute("data-theme", theme, { timeout: 10_000 });
    await phoneScreenshot(surface, name, mask);
  };

  test.describe(`in the ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((chosen) => window.localStorage.setItem("courtside.theme", chosen), theme);
    });

    test("given bookings beside a match and a training, when a phone draws the court plan, then its booking labels match the reviewed baseline", async ({ page, journeyService }) => {
      // given
      await page.setViewportSize({ width: 390, height: 844 });
      await signIn(page, "doe.jane");

      // when
      await selectJourneyDate(page, journeyService.visualDate);
      await expect(page.getByTestId("own-allocation").first()).toBeVisible({ timeout: 10_000 });

      // then
      await atPageTop(page);
      await capture(page.getByTestId("court-plan-view"), baseline("phone-court-plan"));
      await capture(page.getByTestId("mobile-week-navigation"), baseline("phone-court-plan-day-strip"));
    });

    test("given a booking of another member running under the now-line, when a phone draws today's plan, then its label stays above the line", async ({ page, journeyService }) => {
      // given
      await page.setViewportSize({ width: 390, height: 844 });
      await signIn(page, "doe.jane");
      await page.clock.setFixedTime(new Date(`${journeyService.visualDate}T07:10:00Z`));

      // when
      await page.reload();
      await selectJourneyDate(page, journeyService.visualDate);
      const running = page.locator('[data-testid="allocation"][data-booking-id="70000000-0000-0000-0000-000000000002"]');
      const line = (await page.getByTestId("current-time-line").boundingBox())!;
      const label = (await running.getByTestId("allocation-short-label").boundingBox())!;

      // then
      expect(line.y, "the now-line runs through the label").toBeGreaterThan(label.y);
      expect(line.y + line.height, "the now-line runs through the label").toBeLessThan(label.y + label.height);
      const onTop = await page.getByTestId("current-time-line").evaluate((element, point) => {
        const nowLine = element as HTMLElement;
        nowLine.style.pointerEvents = "auto";
        const hit = document.elementFromPoint(point.x, point.y);
        nowLine.style.pointerEvents = "";
        return hit?.closest("[data-booking-id]")?.getAttribute("data-booking-id");
      }, { x: label.x + label.width / 2, y: line.y + line.height / 2 });
      expect(onTop, "the running booking is drawn above the now-line where they cross").toBe("70000000-0000-0000-0000-000000000002");
      await capture(running.locator(".."), baseline("phone-court-plan-now-line"));
    });

    test("given a phone in landscape, when the court plan and its booking dialog are drawn, then both match their reviewed baselines", async ({ page, journeyService }) => {
      // given
      await page.setViewportSize({ width: 852, height: 393 });
      await signIn(page, "doe.jane");

      // when
      await selectJourneyDate(page, journeyService.visualDate);
      await expect(page.getByTestId("own-allocation").first()).toBeVisible({ timeout: 10_000 });

      // then
      await atPageTop(page);
      await capture(page.getByTestId("court-plan-view"), baseline("phone-landscape-court-plan"));
      await capture(page.getByTestId("mobile-week-navigation"), baseline("phone-landscape-day-strip"));

      // when
      await page.locator('[data-testid="free-slot"][data-court-number="2"][data-slot="12:00"]').click();
      await expect(page.getByTestId("booking-dialog").getByTestId("dialog-continues")).toBeVisible({ timeout: 10_000 });

      // then
      await capture(page.getByTestId("booking-dialog"), baseline("phone-landscape-booking-dialog"));
    });

    test("given a phone in landscape, when a series move is previewed, then the move dialog matches its reviewed baseline", async ({ page }) => {
      // given
      await page.setViewportSize({ width: 852, height: 393 });
      await signIn(page, "doe.jane");
      await page.getByTestId("my-bookings-link").click();
      await expect(page.getByTestId("upcoming-bookings")).toBeVisible({ timeout: 10_000 });

      // when
      await page.locator(`[data-testid="move-booking"][data-booking-id="${seriesBookingId}"]`).click();
      const move = page.getByTestId("move-dialog");
      await move.getByTestId("move-duration").fill("90");
      await move.getByTestId("preview-move").click();
      await expect(move.getByTestId("confirm-move")).toBeVisible({ timeout: 10_000 });
      await move.getByTestId("move-preview").scrollIntoViewIfNeeded();

      // then
      await capture(move, baseline("phone-landscape-move-dialog"));
    });

    test("given a phone in landscape, when a long series is to be cancelled whole, then the cancel dialog matches its reviewed baseline", async ({ page, journeyService }) => {
      // given
      await routeLongSeries(page, journeyService.visualDate);
      await page.setViewportSize({ width: 852, height: 393 });
      await signIn(page, "doe.jane");
      await page.getByTestId("my-bookings-link").click();
      await expect(page.getByTestId("upcoming-bookings")).toBeVisible({ timeout: 10_000 });

      // when
      await page.locator(`[data-testid="personal-cancel"][data-booking-id="${seriesBookingId}"]`).click();
      const cancel = page.getByRole("dialog");
      await cancel.getByTestId("scope-WHOLE_SERIES").check();
      await expect(cancel.locator("li")).toHaveCount(12, { timeout: 10_000 });

      // then
      await capture(cancel, baseline("phone-landscape-cancel-dialog"));
    });

    test("given a refused message, when the board reads the message log on a phone, then it matches its reviewed baseline", async ({ page, journeyService }) => {
      // given
      const record = "7c000000-0000-0000-0000-0000000000d1";
      await journeyService.executeSql(`
        INSERT INTO message_record (id, account_id, kind, state, message_id, reason, status_code, queued_at, settled_at)
        VALUES ('${record}', '00000000-0000-0000-0000-000000000102', 'CREDENTIALS_NEW_ACCOUNT', 'REFUSED',
          '<0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.1759349460000@relay.example.org>', 'SendFailedException', '550',
          TIMESTAMPTZ '${journeyInstant}', TIMESTAMPTZ '${journeyInstant}');`);
      try {
        await page.setViewportSize({ width: 390, height: 844 });
        await signIn(page, "configuration-admin");

        // when
        await page.goto("/admin/messages");
        await expect(page.getByTestId("message-row")).toBeVisible({ timeout: 10_000 });

        // then
        await capture(page.getByTestId("admin-messages-view"), baseline("phone-message-log"));
      } finally {
        await journeyService.executeSql(`DELETE FROM message_record WHERE id = '${record}';`);
      }
    });

    test("given a logged warning with a trace, when the board reads the operational log on a phone, then each entry is a readable card", async ({ page }) => {
      // given
      await page.route("**/api/admin/operational-logs/search", (route) => route.fulfill({ json: operationalLogExample }));
      await page.setViewportSize({ width: 412, height: 915 });
      await signIn(page, "configuration-admin");

      // when
      await page.goto("/admin/operational-logs");
      const entry = page.getByTestId("operational-log-row");
      await expect(entry).toBeVisible({ timeout: 10_000 });

      // then
      const overflow = await page.getByTestId("operational-logs-scroll").evaluate((region) => region.scrollWidth - region.clientWidth);
      expect(overflow, "the entry fits the phone without sideways scrolling").toBeLessThanOrEqual(0);
      await entry.scrollIntoViewIfNeeded();
      await expect(entry.getByTestId("operational-log-trace"), "the trace ID is on screen beside the entry").toBeInViewport({ ratio: 1 });
      await capture(page.getByTestId("admin-operational-logs-view"), baseline("phone-operational-log"));

      // when
      await page.setViewportSize({ width: 1440, height: 900 });

      // then
      const traceLines = await entry.getByTestId("operational-log-trace").evaluate((trace) => {
        const text = document.createRange();
        text.selectNodeContents(trace);
        return new Set([...text.getClientRects()].map((line) => Math.round(line.top))).size;
      });
      expect(traceLines, "a desk shows the trace ID on one or two lines").toBeLessThanOrEqual(2);
    });

    test("given a 320 px phone, when the last day of the week is chosen, then the day strip matches its reviewed baseline", async ({ page }) => {
      // given
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto("/");
      const strip = page.getByTestId("mobile-week-navigation");
      await expect(strip).toBeVisible({ timeout: 10_000 });

      // when
      const lastDay = strip.locator('[data-testid^="day-selector-"]').last();
      // A tap on a card's visible sliver does not scroll the strip first, as click() would.
      await lastDay.dispatchEvent("click");
      await expect(lastDay).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
      await expect(page.getByTestId("week-grid")).toBeVisible({ timeout: 10_000 });

      // then
      await capture(strip, baseline("phone-day-strip"));
    });

    test("given German at 320 px, when the message log opens, then its hyphenated heading matches its reviewed baseline", async ({ page }) => {
      // given
      await page.addInitScript(() => window.localStorage.setItem("courtside.locale", "de-DE"));
      await page.setViewportSize({ width: 320, height: 640 });
      await signIn(page, "configuration-admin");

      // when
      await page.goto("/admin/messages");
      await expect(page.getByTestId("admin-messages-view")).toBeVisible({ timeout: 10_000 });
      await expect(page.locator("html")).toHaveAttribute("lang", "de", { timeout: 10_000 });

      // then
      await capture(page.getByRole("heading", { level: 1 }), baseline("phone-german-heading"));
    });
  });
}

test("stable administration surfaces match their reviewed baselines", async ({ page, journeyService }) => {
  // given
  await signIn(page, "configuration-admin");

  // then
  await stableScreenshot(page.getByTestId("primary-navigation"), "primary-navigation.png");

  // when — every gate below waits for something the view renders only once its data arrived,
  // never for the section itself, which is on screen while the request is still in flight
  await onTheVisualDay(page, journeyService.visualDate);
  await page.getByTestId("administration-link").click();
  await expectAdministrationOverview(page);
  await expect(page.getByTestId("overview-today-entry").first()).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-navigation"), "admin-navigation.png");
  await stableScreenshot(page.getByTestId("admin-overview-view"), "admin-overview.png");

  // when
  await backAtTheJourneyInstant(page);

  // when
  await page.getByTestId("admin-setup-link").click();
  await expect(page.getByTestId("setup-progress")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-setup-view"), "admin-setup.png");

  // when
  await page.getByTestId("admin-configuration-link").click();
  await expect(page.getByTestId("logo-url")).toBeEnabled();

  // then
  await stableScreenshot(page.getByTestId("admin-configuration-view"), "admin-configuration.png");

  // when
  await page.getByTestId("admin-deadlines-link").click();
  await expect(page.getByTestId("booking-reminder-hours")).toBeEnabled();

  // then
  await stableScreenshot(page.getByTestId("admin-deadlines-view"), "admin-deadlines.png");

  // when — the save bar is only on screen once something is unsaved
  await page.getByTestId("booking-reminder-hours").fill("12");
  await expect(page.getByTestId("save-bar")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-deadlines-view"), "admin-deadlines-unsaved.png");
  await page.getByTestId("discard-deadlines").click();
  await expect(page.getByTestId("save-bar")).toHaveCount(0);

  // when
  await page.getByTestId("admin-rule-sets-link").click();
  await expect(page.getByTestId("rule-set-name")).toBeVisible();
  await expect(page.getByTestId("rule-ADVANCE_WINDOW-maxDays")).toBeEnabled();

  // then
  await stableScreenshot(page.getByTestId("admin-rule-sets-view"), "admin-rule-sets.png");

  // when
  await page.goto("/admin/facility/courts");
  await expect(page.getByTestId("create-court")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-courts-view"), "admin-courts.png");

  // when
  await page.goto("/admin/facility/opening-hours");
  await expect(page.getByTestId("hours-open-MONDAY")).toBeEnabled();

  // then
  await stableScreenshot(page.getByTestId("admin-opening-hours-view"), "admin-opening-hours.png");

  // when
  await page.goto("/admin/facility/booking-cards");
  await expect(page.getByTestId("create-card")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-booking-cards-view"), "admin-booking-cards.png");

  // when
  await page.getByTestId(/^card-link-/).first().click();
  await expect(page.getByTestId("card-preview")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-booking-card-view"), "admin-booking-card.png");

  // when
  await page.goto("/admin/facility/slot-fillers");
  await expect(page.getByTestId("create-participant-card")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-slot-fillers-view"), "admin-slot-fillers.png");

  // when
  await page.goto("/admin/roster");
  await expect(page.locator('[data-testid^="roster-row-"]').first()).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-roster-view"), "admin-roster.png");

  // when
  await page.goto("/admin/membership-types");
  await expect(page.getByTestId("create-membership-type")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-membership-types-view"), "admin-membership-types.png");

  // when
  await page.goto("/admin/import");
  await expect(page.getByTestId("no-sources")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-import-view"), "admin-import.png");

  // when
  await page.goto("/admin/export");
  await expect(page.getByTestId("bookings-export-download")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-export-view"), "admin-export.png");

  // when
  await page.goto("/admin/retention");
  await expect(page.getByTestId("retention-state-BOOKINGS")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-retention-view"), "admin-retention.png");

  // when
  await page.goto("/admin/utilisation");
  await expect(page.getByTestId("utilisation-row-1")).toBeVisible();
  await expect(page.getByTestId("statistics-confirmed")).toBeVisible();
  await expect(page.getByTestId("statistics-members-total")).toBeVisible();
  await expect(page.getByTestId("statistics-messages").getByRole("status")).toHaveCount(0);
  await expect(page.getByTestId("statistics-choice-1m")).toBeEnabled();

  // then
  await stableScreenshot(page.getByTestId("admin-facility-utilisation-view"), "admin-utilisation.png");

  // when — the journey world is reset between tests, so the empty log is the one state this
  // surface reaches deterministically; a populated one would be masked down to its own chrome
  await page.goto("/admin/audit");
  await expect(page.getByTestId("audit-empty")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-audit-view"), "admin-audit.png");

  // when
  const desk = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("admin-menu")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-menu"), "admin-menu-folded.png");
  await page.setViewportSize(desk);

  // when — the same reset makes the empty message log the one state it reaches deterministically
  await page.goto("/admin/messages");
  await expect(page.getByTestId("messages-empty")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-messages-view"), "admin-messages.png");

  // when
  await page.context().route("**/api/admin/operator-health", (route) => route.fulfill({ json: operatorHealthExample }));
  await page.goto("/admin/operator-health");
  await expect(page.getByTestId("operator-check-mail"), "the sample, not the live instance, is drawn").toHaveAttribute("data-state", "FAILING");

  // then
  await stableScreenshot(page.getByTestId("admin-operator-health-view"), "admin-operator-health.png");
  await page.context().unroute("**/api/admin/operator-health");

  // when
  await page.context().route("**/api/admin/access-grants", (route) => route.fulfill({ json: accessGrantsExample }));
  await page.context().route("**/api/admin/access-control/check", (route) => route.fulfill({ json: connectionCheckExample }));
  await page.goto("/admin/access-grants");
  await expect(page.getByTestId("access-grant-example-failing"), "the example, not the live instance, is drawn").toHaveAttribute("data-status", "FAILING");
  await expect(page.getByTestId("access-check-keypad")).toHaveAttribute("data-outcome", "MANUAL");

  // then
  await stableScreenshot(page.getByTestId("admin-access-grants-view"), "admin-access-grants.png");

  // when
  await page.context().route("**/api/admin/operational-logs/search", (route) => route.fulfill({ json: operationalLogExample }));
  await page.goto("/admin/operational-logs");
  await expect(page.getByTestId("operational-log-row")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-operational-logs-view"), "admin-operational-logs.png");

  // when
  await page.goto("/admin/usage");
  await expect(page.getByTestId("usage-period")).toBeVisible();
  await expect(page.getByTestId("usage-refused-attempts")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-usage-view"), "admin-usage.png");

  // when
  await page.goto("/admin/message-wording");
  await expect(page.getByTestId("wording-body")).toBeEnabled();

  // then
  await stableScreenshot(page.getByTestId("admin-message-wording-view"), "admin-message-wording.png");

  // when
  await page.goto("/admin/facility/access-points");
  await expect(page.getByTestId("create-access-point")).toBeEnabled();

  // then
  await stableScreenshot(page.getByTestId("admin-access-points-view"), "admin-access-points.png");

  // when
  await page.goto("/admin/facility/opening-hours/exceptions");
  await expect(page.getByTestId("opening-periods-empty")).toBeVisible();
  await expect(page.getByTestId("court-closures-empty")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-availability-view"), "admin-availability.png");

  // when
  await page.goto("/admin/facility/opening-hours");
  await page.getByTestId("hours-open-WEDNESDAY").fill("10:30");
  await page.getByTestId("opening-hours-impact-WEDNESDAY").click();
  await expect(page.getByTestId("impact-WEDNESDAY")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-opening-hours-view"), "admin-opening-hours-impact.png");

  // when
  await page.goto("/admin/retention");
  for (const [category, months] of [["BOOKINGS", "24"], ["FORMER_MEMBERS", "12"]]) {
    await page.getByTestId(`retention-months-${category}`).fill(months);
    await page.getByTestId(`retention-save-${category}`).click();
    await expect(page.getByTestId(`retention-state-${category}`)).toHaveAttribute("data-configured", "true");
  }
  await page.getByTestId("retention-preview").click();
  await expect(page.getByTestId("retention-preview-result")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-retention-view"), "admin-retention-preview.png");

  // when
  await page.goto("/admin/appointments");
  await expect(page.getByTestId("managed-bookings")).toBeVisible();
  await expect(page.getByTestId("managed-appointments-page").locator('p[role="status"]')).toHaveCount(0);
  const match = page.getByTestId("booking-70000000-0000-0000-0000-000000000004");
  await expect(match).toBeAttached();

  // then
  await stableScreenshot(page.getByTestId("managed-appointments-page"), "admin-appointments.png");

  // when
  await match.getByTestId("managed-details").click();
  await expect(page.getByRole("dialog").getByTestId("managed-participants")).toBeVisible();

  // then
  await stableScreenshot(page.getByRole("dialog"), "managed-appointment.png");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  // when
  await page.getByTestId("new-series").click();
  await page.getByTestId("series-courts").selectOption("dddddddd-0000-0000-0000-000000000001");
  await page.getByTestId("series-card").selectOption("22222222-2222-2222-2222-222222222222");
  await page.getByTestId("series-starts-on").fill(journeyService.visualDate);
  await page.getByTestId("series-start-time").fill("09:00");
  await page.getByTestId("series-weekday-WEDNESDAY").click();
  await page.getByTestId("series-occurrence-count").fill("2");
  await page.getByTestId("preview-series").click();
  await expect(page.getByTestId("series-creatable-count")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("series-form"), "appointment-series-preview.png");
});

test("given the dark theme, when a confirmation dialog opens over the person administration, then its surface hides the page behind it", async ({ page }) => {
  // given
  await signIn(page, "configuration-admin");
  await page.goto("/admin/roster");
  await page.getByTestId("roster-search").fill("Jane");
  await page.getByTestId("roster-search-submit").click();
  // The unfiltered roster opens on the bootstrap administrator, who has no membership to end.
  await page.getByTestId("person-link-00000000-0000-0000-0000-000000000101").click();

  // when
  await page.getByTestId("end-membership").click();

  // then
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const alpha = await dialog.evaluate((element) => {
    const probe = document.createElement("canvas").getContext("2d")!;
    probe.fillStyle = getComputedStyle(element).backgroundColor;
    probe.fillRect(0, 0, 1, 1);
    return probe.getImageData(0, 0, 1, 1).data[3];
  });
  expect(alpha, "the dialog paints an opaque surface instead of letting the dimmed page show through").toBe(255);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
}

async function signOut(page: Page): Promise<void> {
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-view").or(page.getByTestId("court-plan-view"))).toBeVisible();
}

async function selectVisualDate(page: Page, date: string): Promise<void> {
  await expect(page.getByTestId("week-grid")).toBeVisible();
  const day = page.getByTestId(`day-selector-${date}`);
  if (await day.count() === 0) {
    await page.getByTestId("week-next").click();
  }
  await day.click();
}

// The plan's day strip and head stick at the top, so any scroll past them moves them in the capture.
async function atPageTop(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY), "the page is at its top, where nothing in the plan sticks").toBe(0);
}

// The bar is fixed to the viewport, so a stitched capture would draw it wherever scrolling left it.
async function phoneScreenshot(surface: Locator, name: string, mask?: Locator): Promise<void> {
  const bar = surface.page().getByTestId("primary-navigation-bar");
  await bar.evaluateAll((elements) => elements.forEach((element) => { (element as HTMLElement).style.visibility = "hidden"; }));
  await stableScreenshot(surface, name, mask);
  await bar.evaluateAll((elements) => elements.forEach((element) => { (element as HTMLElement).style.visibility = ""; }));
}

async function stableScreenshot(surface: Locator, name: string, mask?: Locator): Promise<void> {
  await surface.page().evaluate(() => document.fonts.ready);
  await expect(surface).toHaveScreenshot(name, {
    ...screenshotOptions, mask: mask ? [mask] : []
  });
}

test("each configuration surface fits the desktop screen without scrolling in either language", async ({ page }) => {
  // given
  await signIn(page, "configuration-admin");
  const surfaces = [
    { link: "admin-configuration-link", view: "admin-configuration-view", ready: "logo-url" },
    { link: "admin-deadlines-link", view: "admin-deadlines-view", ready: "booking-reminder-hours" },
    { link: "admin-rule-sets-link", view: "admin-rule-sets-view", ready: "rule-ADVANCE_WINDOW-maxDays" },
    { link: "admin-message-wording-link", view: "admin-message-wording-view", ready: "wording-body" },
    { link: "admin-operator-health-link", view: "admin-operator-health-view", ready: "operator-check-backup" },
    { link: "admin-retention-link", view: "admin-retention-view", ready: "retention-months-BOOKINGS" }
  ];

  for (const language of ["de", "en"]) {
    await selectPreference(page, "#locale-preference", language);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await page.getByTestId("administration-link").click();
    for (const surface of surfaces) {
      // when
      await page.getByTestId(surface.link).click();
      await expect(page.getByTestId(surface.ready)).toBeEnabled();

      // then
      await expectToFit(page, `${language} ${surface.view}`, surface.view);
    }

    // when — a club that uploaded its logo is the ordinary case, not the seed's empty one
    await page.getByTestId("admin-configuration-link").click();
    await page.getByTestId("logo-file").setInputFiles(fileURLToPath(new URL("journey-files/club-logo.png", import.meta.url)));
    await page.getByTestId("upload-logo").click();
    try {
      await expect(page.getByTestId("remove-logo")).toBeVisible();
      await page.reload();
      await expect(page.getByTestId("logo-preview")).toBeVisible();
      await expect(page.getByTestId("remove-logo")).toBeEnabled();

      // then
      await expectToFit(page, `${language} admin-configuration-view with an uploaded logo`, "admin-configuration-view");
    } finally {
      await page.getByTestId("remove-logo").click();
      await expect(page.getByTestId("remove-logo")).toHaveCount(0);
    }
    await page.getByTestId("court-plan-link").click();
  }
});

test("given a desktop window shorter than the navigation, when an administrative page is shown, then the navigation scrolls within the window", async ({ page }) => {
  // given
  await signIn(page, "configuration-admin");
  await page.setViewportSize({ width: 1440, height: 640 });
  await page.getByTestId("administration-link").click();

  // when
  await page.getByTestId("admin-configuration-link").click();
  await expect(page.getByTestId("logo-url")).toBeEnabled();
  const measured = await page.evaluate(() => {
    const frame = document.querySelector("[data-testid='admin-navigation-frame']")!;
    const scroll = document.querySelector("[data-testid='admin-navigation-scroll']")!;
    const shell = document.querySelector("[data-testid='admin-shell']")!;
    const below = document.documentElement.scrollHeight - (shell.getBoundingClientRect().bottom + window.scrollY);
    return {
      scrolls: scroll.scrollHeight > scroll.clientHeight,
      end: frame.getBoundingClientRect().bottom + window.scrollY + below,
      page: frame.nextElementSibling!.getBoundingClientRect().bottom + window.scrollY + below,
      viewport: window.innerHeight
    };
  });

  // then
  expect(measured.scrolls, "the navigation keeps its destinations in its own scroll area").toBe(true);
  expect(measured.end, `the navigation alone would end the page within the window: ${JSON.stringify(measured)}`)
    .toBeLessThanOrEqual(Math.max(measured.viewport, measured.page));
  const last = page.getByTestId("admin-navigation").getByRole("link").last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
});

async function expectToFit(page: Page, name: string, view: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  const measured = await page.evaluate((testId) => ({
    document: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
    view: Math.round(document.querySelector(`[data-testid='${testId}']`)!.getBoundingClientRect().height),
    navigation: Math.round(document.querySelector("[data-testid='admin-navigation']")!.getBoundingClientRect().height)
  }), view);
  expect.soft(measured.document, `${name} needs scrolling: ${JSON.stringify(measured)}`)
    .toBeLessThanOrEqual(measured.viewport);
}
