import { expect, selectJourneyDate, selectPreference, test } from "./fixtures";
import { credentialIn, messagesTo, messageTo } from "./mailbox";
import { MEMBER_BOOKING_CARD, STANDARD_RULE_SET } from "./shipped-rows";

function freeSlot(page: import("@playwright/test").Page, court: number, slot: string) {
  return page.locator(`[data-testid="free-slot"][data-court-number="${court}"][data-slot="${slot}"][data-state="free"]`);
}

async function renderedColours(locator: import("@playwright/test").Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderColor, text: style.color };
  });
}

async function renderedContrast(
  page: import("@playwright/test").Page,
  foreground: import("@playwright/test").Locator,
  foregroundProperty: string,
  backdrop?: import("@playwright/test").Locator
): Promise<number> {
  const foregroundColor = await foreground.evaluate((element, property) =>
    getComputedStyle(element).getPropertyValue(property), foregroundProperty);
  const backgroundColor = backdrop
    ? await backdrop.evaluate((element) => getComputedStyle(element).backgroundColor)
    : await foreground.evaluate((element) => {
      for (let candidate = element.parentElement; candidate; candidate = candidate.parentElement) {
        const color = getComputedStyle(candidate).backgroundColor;
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        if (context.getImageData(0, 0, 1, 1).data[3] === 255) return color;
      }
      throw new Error("The element has no opaque rendered backdrop");
    });
  return page.evaluate(({ foregroundColor, backgroundColor }) => {
    const channels = (color: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const luminance = (color: string) => {
      const linear = channels(color).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const foregroundLuminance = luminance(foregroundColor);
    const backgroundLuminance = luminance(backgroundColor);
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
      / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  }, { foregroundColor, backgroundColor });
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

test("the chosen appearance controls alert colours independently of the operating system", async ({ page }) => {
  // given
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  await page.getByTestId("username").fill("nobody");
  await page.getByTestId("password").fill("incorrect-password");
  await page.getByTestId("login-submit").click();
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();

  // then
  const darkUnderLightOs = await renderedColours(alert);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await renderedColours(alert)).toEqual(darkUnderLightOs);

  // when
  await selectPreference(page, "#theme-preference", "light");
  const lightUnderDarkOs = await renderedColours(alert);
  expect(lightUnderDarkOs).not.toEqual(darkUnderLightOs);
  await page.emulateMedia({ colorScheme: "light" });

  // then
  expect(await renderedColours(alert)).toEqual(lightUnderDarkOs);
});

test("booking field violations remain readable in both appearances", async ({ page, journeyService }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await selectJourneyDate(page, journeyService.visualDate);
  await freeSlot(page, 1, "12:00").click();
  await page.getByTestId("booking-submit").click();
  const violation = page.getByTestId("booking-dialog").locator("[data-code]").first();
  await expect(violation).toBeVisible();

  // then
  expect(await renderedContrast(page, violation, "color", page.getByTestId("booking-dialog"))).toBeGreaterThanOrEqual(4.5);

  // when
  await page.getByTestId("booking-close").click();
  await selectPreference(page, "#theme-preference", "light");
  await freeSlot(page, 1, "12:00").click();
  await page.getByTestId("booking-submit").click();
  await expect(violation).toBeVisible();

  // then
  expect(await renderedContrast(page, violation, "color", page.getByTestId("booking-dialog"))).toBeGreaterThanOrEqual(4.5);
});

test("control boundaries and focus indicators remain visible in both appearances", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  const control = page.getByTestId("week-date");
  const free = page.locator('[data-testid="free-slot"][data-state="free"]').first();
  const currentTime = page.getByTestId("current-time-line");
  const tableHeading = page.locator(".day-plan thead th").nth(1);
  const navigation = page.getByTestId("my-bookings-link");

  for (const appearance of ["dark", "light"] as const) {
    if (appearance === "light") await selectPreference(page, "#theme-preference", appearance);

    // then
    expect(await renderedContrast(page, control, "border-top-color", control)).toBeGreaterThanOrEqual(3);
    expect(await renderedContrast(page, free, "outline-color")).toBeGreaterThanOrEqual(3);
    expect(await renderedContrast(page, currentTime, "background-color", tableHeading)).toBeGreaterThanOrEqual(3);

    await control.focus();
    const controlFocus = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(controlFocus).toEqual({ style: "solid", width: 2 });
    expect(await renderedContrast(page, control, "outline-color")).toBeGreaterThanOrEqual(3);

    await page.keyboard.press("Tab");
    await free.focus();
    const freeFocus = await free.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(freeFocus).toEqual({ style: "solid", width: 2 });
    expect(await renderedContrast(page, free, "outline-color")).toBeGreaterThanOrEqual(3);

    await page.keyboard.press("Tab");
    await navigation.focus();
    const navigationFocus = await navigation.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(navigationFocus).toEqual({ style: "solid", width: 2 });
    expect(await renderedContrast(page, navigation, "outline-color")).toBeGreaterThanOrEqual(3);
  }
});

test("the current member destination is visible in both appearances and layouts", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("my-bookings-link")).toBeVisible();

  for (const appearance of ["dark", "light"] as const) {
    if (appearance === "light") await selectPreference(page, "#theme-preference", appearance);

    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      const courtPlan = page.getByTestId("court-plan-link");
      const bookings = page.getByTestId("my-bookings-link");

      // then
      await expect(courtPlan).toHaveAttribute("aria-current", "page");
      expect((await renderedColours(courtPlan)).background)
        .not.toBe((await renderedColours(bookings)).background);
      await expect(courtPlan).toHaveCSS("text-decoration-line", "underline");
      await expect(bookings).toHaveCSS("text-decoration-line", "none");

      // when
      await bookings.click();

      // then
      await expect(bookings).toHaveAttribute("aria-current", "page");
      expect((await renderedColours(bookings)).background)
        .not.toBe((await renderedColours(courtPlan)).background);
      await expect(bookings).toHaveCSS("text-decoration-line", "underline");
      await expect(courtPlan).toHaveCSS("text-decoration-line", "none");
    }
  }
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

test("the bootstrap admin can replace the initial password and continue with setup", async ({ page }) => {
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
  await expect(page.getByTestId("admin-setup-view")).toBeVisible();
  await expect(page.getByTestId("setup-progress")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("admin-setup-view")).toBeVisible();
  await page.getByTestId("court-plan-link").click();
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
  await expect(refusal).toContainText("Your membership type does not allow you to book a court.");
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
    const cardName = await page.getByTestId("booking-card")
      .locator(`option[value="${MEMBER_BOOKING_CARD}"]`).textContent();
    await page.getByTestId("member-search").fill("Mary");
    await page.getByTestId("member-match").click();
    await page.getByTestId("booking-submit").click();
    await expect(page.getByTestId("own-allocation")).toBeVisible();

    // then — the account is English, so the message is; the card is named once, in the club's
    // language, so the same name reaches every member whatever language they read in
    const confirmation = await messageTo(journeyService.mailboxURL, "jane.doe@example.org");
    expect(confirmation.Text).toContain("16:00");
    expect(confirmation.Text).toContain("16:30");
    expect(confirmation.Text).toContain("Court 3");
    expect(confirmation.Text).toContain(cardName);
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
  const createdCard = await cardCreated;
  expect(createdCard.status()).toBe(201);
  const restrictedEventCardId = ((await createdCard.json()) as { id: string }).id;
  await expect(page.getByTestId("admin-save-success")).toBeVisible();
  await page.goto("/");
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("logout").click();
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await selectJourneyDate(page, journeyService.visualDate);
  await freeSlot(page, 3, "13:00").click();
  await page.getByTestId("booking-card").selectOption(restrictedEventCardId);
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
  await expect(page.getByTestId("admin-setup-view")).toBeVisible();
  await page.getByTestId("admin-configuration-link").click();
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
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /\/api\/public\/config\/logo\?v=[0-9a-f]{64}$/);
  const logoRemoved = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/config/logo") && response.request().method() === "DELETE"
  );
  await page.getByTestId("remove-logo").click();
  expect((await logoRemoved).status()).toBe(200);
  await expect(page.getByTestId("club-logo")).toHaveAttribute("src", "/icon.svg");
  // The editor opens on whichever rule set sorts first, so the one this member is measured by is
  // chosen rather than assumed: its own seeded window is what says the switch has landed.
  await page.getByTestId("rule-set").selectOption(STANDARD_RULE_SET);
  await expect(page.getByTestId("rule-ADVANCE_WINDOW-maxDays")).toHaveValue("7");
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
      .toContain("A court in your booking has been deactivated.");
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

test.describe("renaming a court", () => {
  const court = "dddddddd-0000-0000-0000-000000000003";

  // One journey world serves every worker and the court plan renders this name into a reviewed
  // baseline. An afterEach reports its own failure beside the test's instead of in place of it.
  test.afterEach(async ({ journeyService }) => {
    await journeyService.executeSql(`UPDATE court SET name = NULL WHERE id = '${court}';`);
  });

  test("an admin renames a court in the list and finds that change in the log", async ({ page }) => {
    // given
    await page.goto("/login");
    await page.getByTestId("username").fill("configuration-admin");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await page.getByTestId("administration-link").click();
    await page.getByTestId("admin-courts-link").click();
    await expect(page.getByTestId("admin-courts-view")).toBeVisible();
    const written = () => page.waitForResponse((response) =>
      response.url().endsWith(`/api/admin/courts/${court}`) && response.request().method() === "PUT"
    );

    // when
    const renamed = written();
    await page.getByTestId(`edit-court-name-${court}`).click();
    await page.getByTestId("court-editor").fill("Practice Wall");
    await page.getByTestId("confirm-court-edit").click();
    expect((await renamed).status()).toBe(200);

    // then
    await expect(page.getByTestId(`edit-court-name-${court}`)).toContainText("Practice Wall");
    await page.getByTestId("admin-audit-link").click();
    await expect(page.getByTestId("admin-audit-view")).toBeVisible();
    await expect(page.locator(
      `[data-testid="audit-row"][data-subject-id="${court}"][data-event-type="facility.court.changed"]`
    ).first()).toBeVisible();

    // when — clearing the name is the other half of the same control
    await page.getByTestId("admin-courts-link").click();
    const cleared = written();
    await page.getByTestId(`edit-court-name-${court}`).click();
    await page.getByTestId("court-editor").fill("");
    await page.getByTestId("confirm-court-edit").click();
    expect((await cleared).status()).toBe(200);

    // then
    await expect(page.getByTestId("court-editor")).toHaveCount(0);
    await expect(page.getByTestId(`edit-court-name-${court}`)).not.toContainText("Practice Wall");
  });
});

test("a disabled button and a focused field read differently from their resting state in both appearances", async ({ page }) => {
  // given
  const court = "dddddddd-0000-0000-0000-000000000002";
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("administration-link").click();
  await page.getByTestId("admin-courts-link").click();
  await expect(page.getByTestId("admin-courts-view")).toBeVisible();
  const editor = page.getByTestId("court-editor");
  const confirm = page.getByTestId("confirm-court-edit");

  for (const appearance of ["dark", "light"] as const) {
    // given
    if (appearance === "light") {
      await page.getByTestId("dismiss-court-edit").click();
      await expect(editor).toHaveCount(0);
      await selectPreference(page, "#theme-preference", appearance);
    }
    const unavailable = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.background = "var(--cs-raised)";
      probe.style.color = "var(--cs-muted)";
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const colours = { background: style.backgroundColor, text: style.color };
      probe.remove();
      return colours;
    });
    await page.getByTestId(`edit-court-number-${court}`).click();
    await editor.fill("7");
    await expect(confirm).toBeEnabled();
    const enabled = await renderedColours(confirm);

    // when
    await editor.fill("1000");

    // then
    await expect(confirm).toBeDisabled();
    await expect(confirm, `${appearance}: a button takes the weight Button declares`).toHaveCSS("font-weight", "600");
    await expect(confirm, `${appearance}: a disabled button takes the raised surface`)
      .toHaveCSS("background-color", unavailable.background);
    await expect(confirm, `${appearance}: a disabled button takes the muted text`)
      .toHaveCSS("color", unavailable.text);
    expect(enabled.background, `${appearance}: the enabled fill must differ from the disabled one`)
      .not.toBe(unavailable.background);
    expect(enabled.text, `${appearance}: the enabled text must differ from the disabled one`)
      .not.toBe(unavailable.text);
    await expect(editor).toBeFocused();
    await expect(editor, `${appearance}: a focused field keeps its focus outline`).toHaveCSS("outline-style", "solid");
  }
});

test("a caution reads as a warning rather than a failure in both appearances", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("administration-link").click();
  await page.getByTestId("admin-configuration-link").click();
  await expect(page.getByTestId("admin-configuration-view")).toBeVisible();
  const caution = page.getByTestId("primary-color-contrast");

  // when
  await page.getByTestId("primary-color-value").fill("#777777");

  // then
  await expect(caution, "a caution is announced politely, not as an alert").toHaveRole("status");
  for (const appearance of ["dark", "light"] as const) {
    if (appearance === "light") await selectPreference(page, "#theme-preference", appearance);
    const tone = (name: string) => page.evaluate((token) => {
      const probe = document.createElement("span");
      probe.style.background = `var(${token}-surface)`;
      probe.style.color = `var(${token}-text)`;
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const colours = { background: style.backgroundColor, text: style.color };
      probe.remove();
      return colours;
    }, name);
    const warning = await tone("--cs-notice-warning");
    const error = await tone("--cs-notice-error");

    await expect(caution, `${appearance}: a caution takes the warning surface`).toHaveCSS("background-color", warning.background);
    await expect(caution, `${appearance}: a caution takes the warning text`).toHaveCSS("color", warning.text);
    expect(warning.background, `${appearance}: the warning surface must differ from the error surface`).not.toBe(error.background);
    expect(await renderedContrast(page, caution, "color", caution), `${appearance}: the caution stays readable`)
      .toBeGreaterThanOrEqual(4.5);
  }
});

test.describe("comparing membership types", () => {
  const added = Array.from({ length: 8 }, (_, index) => `cccccccc-0000-0000-0000-0000000001${String(index).padStart(2, "0")}`);

  test.afterEach(async ({ journeyService }) => {
    await journeyService.executeSql(`DELETE FROM membership_type WHERE id IN (${added.map((id) => `'${id}'`).join(", ")});`);
  });

  test("a board compares ten membership types on one laptop screen, and a narrow desk still fits them", async ({ page, journeyService }) => {
    // given
    await journeyService.executeSql(`INSERT INTO membership_type (id, name, rule_set_id) VALUES ${added
      .map((id, index) => `('${id}', 'Seasonal member group ${index + 1}', 'aaaaaaaa-0000-0000-0000-000000000001')`).join(", ")};`);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/login");
    await page.getByTestId("username").fill("configuration-admin");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await selectPreference(page, "#locale-preference", "de");
    const layout = () => page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('[data-testid^="membership-type-cccccccc"]')];
      const first = rows[0].getBoundingClientRect();
      const last = rows[rows.length - 1].getBoundingClientRect();
      const name = rows[0].querySelector<HTMLElement>('[data-testid^="membership-type-name-"]')!.getBoundingClientRect();
      const state = rows[0].querySelector<HTMLElement>('[data-testid^="membership-type-state-"]')!.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rowsHeight: last.bottom - first.top,
        screen: window.innerHeight - document.querySelector("thead")!.getBoundingClientRect().height,
        stateBesideName: state.left >= name.right && state.top < name.bottom && state.bottom > name.top
      };
    });

    // when
    await page.getByTestId("administration-link").click();
    await page.getByTestId("admin-membership-types-link").click();
    await expect(page.locator('[data-testid^="membership-type-cccccccc"]')).toHaveCount(10);
    await expect(page.getByTestId("membership-type-holders-cccccccc-0000-0000-0000-000000000001")).toHaveText(/\d/);

    // then
    const laptop = await layout();
    expect(laptop.overflow, "the table fits beside the administration menu").toBeLessThanOrEqual(0);
    expect(laptop.stateBesideName, "a type's availability sits beside its name").toBe(true);
    expect(laptop.rowsHeight, "ten types and their column headings fit within one screen").toBeLessThanOrEqual(laptop.screen);

    // when
    await page.setViewportSize({ width: 1024, height: 800 });

    // then
    await expect.poll(async () => (await layout()).overflow, { message: "the narrowest desk still fits the table" }).toBeLessThanOrEqual(0);
  });
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
  const credential = credentialIn(mailed, "Einmalpasswort:");
  await expect(page.getByTestId("account-username")).toHaveValue("roe.mary");
  await expect(page.getByTestId("account-roles-MEMBER")).toBeChecked();
  await expect(page.getByTestId("admin-person-view")).not.toContainText(credential);
  // the message is handed over after the credential is stored, so reading it settles the state
  await page.reload();
  await expect(page.getByTestId("credential-state"))
    .toHaveAttribute("data-state", "CREDENTIAL_ISSUED");

  // when — the member signs in with what the instance mailed them and replaces it. Their
  // first name is in the first password they try, which is what the policy refuses.
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("roe.mary");
  await page.getByTestId("password").fill(credential);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("initial-password-view")).toBeVisible();
  await page.getByTestId("new-password").fill("mary-chose-this-one");
  await page.getByTestId("confirm-password").fill("mary-chose-this-one");
  const refused = page.waitForResponse((response) =>
    response.url().endsWith("/api/account/initial-password") && response.request().method() === "PUT"
  );
  await page.getByTestId("password-submit").click();
  const refusal = await refused;
  expect(refusal.status()).toBe(400);
  const problem = (await refusal.json()) as { type?: string };
  expect(problem.type).toBe("urn:courtside:error:password-too-guessable");
  await expect(page.getByTestId("password-failure")).toBeVisible();
  await expect(page.getByTestId("initial-password-view")).toBeVisible();
  await page.getByTestId("new-password").fill("the-one-they-picked-alone");
  await page.getByTestId("confirm-password").fill("the-one-they-picked-alone");
  await page.getByTestId("password-submit").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("roe.mary");
  await page.getByTestId("password").fill("the-one-they-picked-alone");
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
  await expect(page.getByTestId("admin-setup-view")).toBeVisible();
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
