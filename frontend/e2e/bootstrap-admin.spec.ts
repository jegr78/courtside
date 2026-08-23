import { expect, selectJourneyDate, test } from "./fixtures";
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
  await page.locator("#locale-preference").selectOption("en");
  await page.locator("#theme-preference").selectOption("light");
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
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
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
  await page.getByTestId("admin-facility-link").click();
  await page.getByTestId("new-card-label").fill("Restricted event");
  await page.getByTestId("new-card-role-MEMBER").check();
  await page.getByTestId("new-card-counts").fill("2");
  const cardCreated = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/booking-cards") && response.request().method() === "POST"
  );
  await page.getByTestId("create-card").click();
  expect((await cardCreated).status()).toBe(201);
  await expect(page.getByRole("status")).toBeVisible();
  await page.goto("/");
  await page.getByTestId("logout").click();
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await selectJourneyDate(page, journeyService.visualDate);
  await freeSlot(page, 3, "13:00").click();
  await page.getByTestId("booking-card").selectOption({ label: "Restricted event" });
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
  await page.getByTestId("admin-configuration-link").click();
  await expect(page.getByTestId("admin-configuration-view")).toBeVisible();
  await expect(page.getByTestId("time-zone")).toHaveValue("Europe/Berlin");

  // when
  const clubName = page.getByTestId("club-name");
  await clubName.fill("Example Racquet Club");
  await clubName.press("Tab");
  await expect(clubName).toHaveValue("Example Racquet Club");
  const configSaved = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/config") && response.request().method() === "PUT"
  );
  await page.getByTestId("save-club-config").click();
  const configResponse = await configSaved;
  expect(configResponse.status()).toBe(200);
  const changedConfig = await configResponse.json() as { clubName: string };
  expect(changedConfig.clubName).toBe("Example Racquet Club");
  await expect(page.getByTestId("admin-save-success")).toBeVisible();
  await expect(page.getByTestId("club-brand-name")).toHaveText("Example Racquet Club");
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

test("an admin takes a court out of service and restores it through the browser", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("admin-facility-link").click();
  await expect(page.getByTestId("admin-facility-view")).toBeVisible();
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
  await page.getByTestId("admin-facility-link").click();
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
  await page.getByTestId("admin-facility-link").click();
  await expect(page.getByTestId("admin-facility-view")).toBeVisible();
  const court = "dddddddd-0000-0000-0000-000000000003";

  // when
  const courtDeactivated = page.waitForResponse((response) =>
    response.url().endsWith(`/api/admin/courts/${court}/active`)
      && response.request().method() === "PUT"
  );
  await page.getByTestId(`toggle-court-${court}`).click();
  expect((await courtDeactivated).status()).toBe(200);
  await page.goto("/");
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
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("admin-roster-link")).toBeVisible();
  await page.goto(`/admin/roster/${personId}`);
  await expect(page.getByTestId("credential-state"))
    .toHaveAttribute("data-state", "PASSWORD_CHOSEN");
  await page.getByTestId("send-credentials").click();
  await page.getByTestId("cancel-send-credentials").click();

  // then — dismissing asks nothing of the instance, so the member keeps what they chose
  await expect(page.getByTestId("confirm-send-credentials")).toHaveCount(0);
  expect(await messagesTo(journeyService.mailboxURL, "mary.roe@example.org")).toHaveLength(1);

  // when
  await page.getByTestId("send-credentials").click();
  await page.getByTestId("confirm-send-credentials").click();

  // then
  await expect
    .poll(async () => (await messagesTo(journeyService.mailboxURL, "mary.roe@example.org")).length)
    .toBe(2);
});
