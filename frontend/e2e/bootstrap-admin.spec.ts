import { expect, selectJourneyDate, selectPreference, test } from "./fixtures";
import { credentialIn, messagesTo, messageTo } from "./mailbox";

function freeSlot(page: import("@playwright/test").Page, court: number, slot: string) {
  return page.locator(`[data-testid="free-slot"][data-court-number="${court}"][data-slot="${slot}"][data-state="free"]`);
}

test("language and theme preferences persist across reloads", async ({ page }) => {
  // given
  await page.goto("/");

  // then
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#locale-preference")).toHaveValue("de");
  await expect(page.locator("#theme-preference")).toHaveValue("dark");

  // when
  await selectPreference(page, "#locale-preference", "en");
  await selectPreference(page, "#theme-preference", "light");
  await page.reload();

  // then
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("#locale-preference")).toHaveValue("en");
  await expect(page.locator("#theme-preference")).toHaveValue("light");
});

test("the application shell identifies the exact running build", async ({ page }) => {
  // given
  await page.goto("/");
  // Asking from the page keeps the request on the origin the member uses, proxy and all.
  const source = await page.evaluate(() => fetch("/api/source").then((response) => response.json())) as {
    version: string;
    commit?: string;
    environment: string;
  };

  // when
  await page.getByTestId("build-identity").click();

  // then
  await expect(page.getByTestId("build-identity")).toContainText(`v${source.version}`);
  await expect(page.getByRole("dialog")).toContainText(source.version);
  await expect(page.getByRole("dialog")).toContainText(source.environment);
  if (source.commit) {
    await expect(page.getByRole("dialog")).toContainText(source.commit);
  }
});

test("the bootstrap admin can replace the initial password and maintain a session", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("bootstrap-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();

  await expect(page.getByTestId("initial-password-view")).toBeVisible();
  await page.getByTestId("new-password").fill("permanent-password");
  await page.getByTestId("confirm-password").fill("permanent-password");
  await page.getByTestId("password-submit").click();

  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("bootstrap-admin");
  await page.getByTestId("password").fill("permanent-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
});

test("a seeded member stays signed in across a reload and can sign out", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();

  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await expect(page.getByTestId("week-grid")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
});

test("a barred member sees the refusal before a booking dialog can open", async ({ page, journeyService }) => {
  // given
  await journeyService.executeSql(`
    INSERT INTO rule_definition (id, rule_set_id, rule_type, params)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000099',
      'aaaaaaaa-0000-0000-0000-000000000001', 'NO_COURT_BOOKING', '{}'::jsonb)
  `);
  await page.goto("/login");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");

  // when
  await page.getByTestId("login-submit").click();

  // then
  const refusal = page.getByTestId("booking-eligibility");
  await expect(refusal).toContainText("Booking a court is not open to you.");
  await expect(refusal.locator('[data-code="booking.rule.noCourtBooking"]')).toBeVisible();
  await selectJourneyDate(page, journeyService.visualDate);
  const targetSlot = freeSlot(page, 2, "12:00");
  await expect(targetSlot).toBeVisible();
  await expect(targetSlot).not.toHaveRole("button");
  await targetSlot.click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("the plan keeps the current time visible and leaves the page where it was",
  async ({ page }) => {
    // given
    await page.goto("/login");
    await page.getByTestId("username").fill("doe.jane");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("court-plan-view")).toBeVisible();

    // when
    await expect(page.getByTestId("current-time-line")).toBeInViewport();

    // then — a page that scrolls itself takes the navigation out from under whoever reaches for it
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(0);
    await expect(page.getByTestId("my-bookings-link")).toBeInViewport();
  });

test("a member drags across the grid and the dialog opens on the period they drew",
  async ({ page, journeyService }) => {
    // given
    await page.goto("/login");
    await page.getByTestId("username").fill("doe.jane");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await selectJourneyDate(page, journeyService.visualDate);
    const from = freeSlot(page, 4, "14:00");
    const to = freeSlot(page, 4, "15:00");
    await expect(from).toBeVisible();
    // page.mouse takes viewport coordinates and scrolls nothing on its own.
    await to.scrollIntoViewIfNeeded();
    const start = await from.boundingBox();
    const end = await to.boundingBox();

    // when — a real pointer drag, which synthetic events in the component suite cannot stand for
    await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
    await page.mouse.down();
    await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 8 });
    await page.mouse.up();

    // then — three grid windows, so the dialog opens on ninety minutes without touching the select
    await expect(page.getByTestId("booking-dialog")).toBeVisible();
    await expect(page.getByTestId("booking-duration")).toHaveValue("90");
    await expect(page.getByTestId("booking-period")).toContainText("2:00");
    await expect(page.getByTestId("booking-period")).toContainText("3:30");
  });

test("a member who books a court is written to, so the booking outlives the dialog",
  async ({ page, journeyService }) => {
    // given
    await page.goto("/login");
    await page.getByTestId("username").fill("doe.jane");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await selectJourneyDate(page, journeyService.visualDate);
    const targetSlot = freeSlot(page, 3, "16:00");
    await expect(targetSlot).toBeVisible();

    // when
    await targetSlot.click();
    await page.getByTestId("member-search").fill("Mary");
    await page.getByTestId("member-match").click();
    await page.getByTestId("booking-submit").click();
    await expect(page.getByTestId("own-allocation")).toBeVisible();

    // then — the account is English, so the message is, and it carries the whole booking
    const confirmation = await messageTo(journeyService.mailboxURL, "jane.doe@example.org");
    expect(confirmation.Text).toContain("16:00");
    expect(confirmation.Text).toContain("16:30");
    expect(confirmation.Text).toContain("Court 3");
    expect(confirmation.Text).toContain("Member booking");
  });

test("a seeded member can book a free slot and cancel it again", async ({ page, journeyService }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await selectJourneyDate(page, journeyService.visualDate);
  const targetSlot = freeSlot(page, 2, "12:00");
  await expect(targetSlot).toBeVisible();

  // when
  await targetSlot.click();
  await page.getByTestId("member-search").fill("Mary");
  await page.getByTestId("member-match").click();
  await page.getByTestId("booking-submit").click();

  // then
  const gridBooking = page.getByTestId("own-allocation");
  await expect(gridBooking).toBeVisible();
  const bookingId = await gridBooking.getAttribute("data-booking-id");
  expect(bookingId).not.toBeNull();

  await page.reload();
  await page.getByTestId("my-bookings-link").click();
  const personalBooking = page.locator(`[data-testid="personal-cancel"][data-booking-id="${bookingId}"]`);
  await expect(personalBooking).toBeVisible();

  // when
  await personalBooking.click();
  await page.getByTestId("confirm-cancellation").click();

  // then
  await expect(personalBooking).not.toBeVisible();
});

test("a guest-restricted booking card rejects a guest through the browser", async ({ page, journeyService }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("administration-link").click();
  await page.getByTestId("admin-booking-cards-link").click();
  await page.getByTestId("new-card-label").fill("Restricted event");
  await page.getByTestId("new-card-role-MEMBER").check();
  await page.getByTestId("new-card-counts-entry").fill("2");
  await page.getByTestId("new-card-counts-add").click();
  const cardCreated = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/booking-cards") && response.request().method() === "POST"
  );
  await page.getByTestId("create-card").click();
  expect((await cardCreated).status()).toBe(201);
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto("/");
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("logout").click();
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await selectJourneyDate(page, journeyService.visualDate);
  await freeSlot(page, 3, "13:00").click();
  await page.getByTestId("booking-card").selectOption({ label: "Restricted event" });
  await page.getByTestId("booking-more-summary").click();
  await page.getByTestId("guest-name").fill("John Roe");

  // when
  await page.getByTestId("booking-submit").click();

  // then
  await expect(page.locator('[data-code="booking.participants.guestNotAllowed"]')).toBeVisible();
  await expect(page.getByTestId("booking-dialog")).toBeVisible();
});

test("an admin changes club configuration and a booking rule through the browser", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("administration-link").click();
  await expect(page.getByTestId("admin-configuration-view")).toBeVisible();
  await expect(page.getByTestId("time-zone")).toHaveValue("Europe/Berlin");

  // when
  const clubName = page.getByTestId("club-name");
  await clubName.fill("Example Racquet Club");
  await page.getByTestId("logo-url").fill("/icon.svg");
  await clubName.press("Tab");
  await expect(clubName).toHaveValue("Example Racquet Club");
  const withoutMembershipType = page.getByTestId("no-membership-type-rule-set");
  const offered = await withoutMembershipType.locator("option").nth(1).getAttribute("value");
  expect(offered).toBeTruthy();
  await withoutMembershipType.selectOption(offered);
  const configSaved = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/config") && response.request().method() === "PUT"
  );
  await page.getByTestId("save-club-config").click();
  const configResponse = await configSaved;
  expect(configResponse.status()).toBe(200);
  const changedConfig =
    await configResponse.json() as { clubName: string; noMembershipTypeRuleSetId: string };
  expect(changedConfig.clubName).toBe("Example Racquet Club");
  expect(changedConfig.noMembershipTypeRuleSetId).toBe(offered);
  await expect(page.getByTestId("admin-save-success")).toBeVisible();
  await expect(page.getByTestId("club-brand-name")).toHaveText("Example Racquet Club");
  await page.getByTestId("logo-file").setInputFiles({
    name: "club.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
  });
  const logoUploaded = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/config/logo") && response.request().method() === "PUT"
  );
  await page.getByTestId("upload-logo").click();
  expect((await logoUploaded).status()).toBe(200);
  await expect(page.getByTestId("club-logo")).toHaveAttribute("src", /\/api\/public\/config\/logo\?v=[0-9a-f]{64}$/);
  const logoRemoved = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/config/logo") && response.request().method() === "DELETE"
  );
  await page.getByTestId("remove-logo").click();
  expect((await logoRemoved).status()).toBe(200);
  await expect(page.getByTestId("club-logo")).toHaveAttribute("src", "/icon.svg");
  await page.getByTestId("rule-ADVANCE_WINDOW-maxDays").fill("1");
  const ruleSaved = page.waitForResponse((response) =>
    response.url().includes("/api/admin/rule-sets/")
      && response.url().endsWith("/rules/ADVANCE_WINDOW")
      && response.request().method() === "PUT"
  );
  await page.getByTestId("save-rule-ADVANCE_WINDOW").click();
  expect((await ruleSaved).status()).toBe(200);

  // then
  await expect(page.getByTestId("admin-save-success")).toBeVisible();

  // when
  await page.goto("/");
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("logout").click();
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("week-next").click();
  await freeSlot(page, 4, "14:00").click();
  await page.getByTestId("member-search").fill("Mary");
  await page.getByTestId("member-match").click();
  await page.getByTestId("booking-submit").click();

  // then
  await expect(page.locator('[data-code="booking.rule.advanceWindow.exceeded"]')).toBeVisible();
});

test("a court going out of service reaches the member whose booking is on it",
  async ({ page, journeyService }) => {
    // given — a member books, and the board later needs that court back
    await page.goto("/login");
    await page.getByTestId("username").fill("doe.jane");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await selectJourneyDate(page, journeyService.visualDate);
    await freeSlot(page, 3, "13:00").click();
    await page.getByTestId("member-search").fill("Mary");
    await page.getByTestId("member-match").first().click();
    await page.getByTestId("booking-submit").click();
    await expect(page.locator('tr[data-slot="13:00"] [data-testid="own-allocation"]')).toBeVisible();
    await page.getByTestId("preferences-menu").click();
    await page.getByTestId("logout").click();
    await expect(page.getByTestId("login-view")).toBeVisible();
    await page.getByTestId("username").fill("configuration-admin");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await page.getByTestId("administration-link").click();
    await page.getByTestId("admin-courts-link").click();
    await expect(page.getByTestId("admin-courts-view")).toBeVisible();

    // when
    const court = "dddddddd-0000-0000-0000-000000000003";
    const deactivated = page.waitForResponse((response) =>
      response.url().endsWith(`/api/admin/courts/${court}/active`)
        && response.request().method() === "PUT");
    await page.getByTestId(`toggle-court-${court}`).click();
    expect((await deactivated).status()).toBe(200);

    // then — the board's impact list already said which bookings sit on it; now they know too
    // The newest message, because the confirmation of that same booking is already in the mailbox.
    await expect
      .poll(async () => (await messageTo(journeyService.mailboxURL, "jane.doe@example.org")).Text)
      .toContain("out of service");
    expect((await messageTo(journeyService.mailboxURL, "jane.doe@example.org")).Text)
      .toContain("13:00");
  });

test("an admin takes a court out of service and restores it through the browser", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("administration-link").click();
  await page.getByTestId("admin-courts-link").click();
  await expect(page.getByTestId("admin-courts-view")).toBeVisible();
  const court = "dddddddd-0000-0000-0000-000000000004";

  // when
  const courtDeactivated = page.waitForResponse((response) =>
    response.url().endsWith(`/api/admin/courts/${court}/active`)
      && response.request().method() === "PUT"
  );
  await page.getByTestId(`toggle-court-${court}`).click();
  expect((await courtDeactivated).status()).toBe(200);
  await page.goto("/");

  // then
  await expect(page.getByTestId("court-column-4")).not.toBeVisible();

  // when
  await page.getByTestId("administration-link").click();
  await page.getByTestId("admin-courts-link").click();
  const courtReactivated = page.waitForResponse((response) =>
    response.url().endsWith(`/api/admin/courts/${court}/active`)
      && response.request().method() === "PUT"
  );
  await page.getByTestId(`toggle-court-${court}`).click();
  expect((await courtReactivated).status()).toBe(200);
  await page.goto("/");

  // then
  await expect(page.getByTestId("court-column-4")).toBeVisible();
});

test("an admin changes a court and finds that change in the log", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("administration-link").click();
  await page.getByTestId("admin-courts-link").click();
  await expect(page.getByTestId("admin-courts-view")).toBeVisible();
  const court = "dddddddd-0000-0000-0000-000000000003";

  // when
  const courtDeactivated = page.waitForResponse((response) =>
    response.url().endsWith(`/api/admin/courts/${court}/active`)
      && response.request().method() === "PUT"
  );
  await page.getByTestId(`toggle-court-${court}`).click();
  expect((await courtDeactivated).status()).toBe(200);
  await page.goto("/");
  await page.getByTestId("administration-link").click();
  await page.getByTestId("admin-audit-link").click();
  await expect(page.getByTestId("admin-audit-view")).toBeVisible();

  // then
  const entry = page.locator(
    `[data-testid="audit-row"][data-subject-id="${court}"][data-event-type="facility.court.availabilityChanged"]`
  );
  await expect(entry).toBeVisible();
  await expect(entry.getByTestId("audit-message")).toHaveText("Court deactivated");
  await expect(entry.getByTestId("audit-subject")).toHaveText("3");
  await expect(entry.getByTestId("audit-actor")).toHaveText("configuration-admin");
});

test("an admin adds a person, gives them an account, and that person signs in and books", async ({ page, journeyService }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("administration-link").click();
  await page.getByTestId("admin-roster-link").click();
  await expect(page.getByTestId("admin-roster-view")).toBeVisible();

  // when
  await page.getByTestId("new-person-first-name").fill("Mary");
  await page.getByTestId("new-person-last-name").fill("Roe");
  await page.getByTestId("new-person-email").fill("mary.roe@example.org");
  const personCreated = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/roster") && response.request().method() === "POST"
  );
  await page.getByTestId("create-person").click();
  const { personId } = await (await personCreated).json() as { personId: string };

  // then
  await expect(page).toHaveURL(new RegExp(`/admin/roster/${personId}$`));
  await expect(page.getByTestId("person-email")).toHaveValue("mary.roe@example.org");

  // when — nothing here asks for a password: the instance generates one and sends it
  await expect(page.getByTestId("new-account-password")).toHaveCount(0);
  await expect(page.getByTestId("credential-destination")).toContainText("mary.roe@example.org");
  await page.getByTestId("new-account-username").fill("roe.mary");
  await page.getByTestId("new-account-role-MEMBER").check();
  const accountCreated = page.waitForResponse((response) =>
    response.url().endsWith(`/api/admin/roster/${personId}/account`) && response.request().method() === "POST"
  );
  await page.getByTestId("create-account").click();
  expect((await accountCreated).status()).toBe(201);

  // then — the board sees where the account stands, and never the password itself
  const mailed = await messageTo(journeyService.mailboxURL, "mary.roe@example.org");
  const credential = credentialIn(mailed, "Passwort:");
  await expect(page.getByTestId("account-username")).toHaveValue("roe.mary");
  await expect(page.getByTestId("account-roles-MEMBER")).toBeChecked();
  await expect(page.getByTestId("admin-person-view")).not.toContainText(credential);
  // the message is handed over after the credential is stored, so reading it settles the state
  await page.reload();
  await expect(page.getByTestId("credential-state"))
    .toHaveAttribute("data-state", "CREDENTIAL_ISSUED");

  // when — the member signs in with what the instance mailed them and replaces it
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("roe.mary");
  await page.getByTestId("password").fill(credential);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("initial-password-view")).toBeVisible();
  await page.getByTestId("new-password").fill("mary-chose-this-one");
  await page.getByTestId("confirm-password").fill("mary-chose-this-one");
  await page.getByTestId("password-submit").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("roe.mary");
  await page.getByTestId("password").fill("mary-chose-this-one");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await selectJourneyDate(page, journeyService.visualDate);
  await freeSlot(page, 2, "15:00").click();
  await page.getByTestId("member-search").fill("Major");
  await page.getByTestId("member-match").click();
  await page.getByTestId("booking-submit").click();

  // then
  await expect(page.getByTestId("own-allocation")).toBeVisible();

  // when — the board sends again, which now destroys a password the member chose
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("administration-link")).toBeVisible();
  await page.goto(`/admin/roster/${personId}`);
  await expect(page.getByTestId("credential-state"))
    .toHaveAttribute("data-state", "PASSWORD_CHOSEN");
  const sentSoFar = (await messagesTo(journeyService.mailboxURL, "mary.roe@example.org")).length;
  await page.getByTestId("send-credentials").click();
  await page.getByTestId("cancel-send-credentials").click();

  // then — dismissing asks nothing of the instance, so the member keeps what they chose
  await expect(page.getByTestId("confirm-send-credentials")).toHaveCount(0);
  expect(await messagesTo(journeyService.mailboxURL, "mary.roe@example.org"))
    .toHaveLength(sentSoFar);

  // when
  await page.getByTestId("send-credentials").click();
  await page.getByTestId("confirm-send-credentials").click();

  // then
  await expect
    .poll(async () => (await messagesTo(journeyService.mailboxURL, "mary.roe@example.org")).length)
    .toBe(sentSoFar + 1);
});
