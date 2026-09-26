import { readFileSync } from "node:fs";
import { type Page, type TestInfo } from "@playwright/test";
import { backAtTheJourneyInstant, expect, expectAdministrationOverview, onTheVisualDay, selectPreference, test } from "./fixtures";

// The guides are read in the light theme on a page column, in the language its project names, and
// the height is the dialogue's bound: a shorter screen scrolls one and publishes it cut off.
test.use({ viewport: { width: 1280, height: 1000 } });

interface Capture {
  readonly name: string;
  readonly surface: string;
  readonly pages: Record<string, string>;
}

const catalogue = JSON.parse(readFileSync(
  new URL("../../site/screenshots/captures.json", import.meta.url), "utf8")) as {
    locales: string[];
    captures: Capture[];
  };

// The project decides the language, so one run produces both and neither depends on an
// environment variable somebody has to remember.
function localeOf(info: TestInfo): string {
  return info.project.name.replace(/^guides-/, "");
}

// A source offers the columns of the file the board picks, so the form stays empty until it has
// one, and the guide would otherwise show an empty form beside a passage about mapped columns.
const MEMBER_LIST = [
  "Number;Given;Family;Mail",
  "9001;Jane;Doe;jane.doe@example.org",
  "9002;John;Roe;john.roe@example.org"
].join("\n");

const drivers: Record<string, (page: Page, visualDate: string) => Promise<void>> = {
  "court-plan": async (page, visualDate) => {
    await page.goto("/");
    await expect(page.getByTestId("public-club-name")).toBeVisible();
    await selectVisualDate(page, visualDate);
    await expectDesktopCourtPlanToFit(page);
  },
  "sign-in": async (page) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-submit")).toBeVisible();
  },
  "account-recovery": async (page) => {
    await page.getByTestId("forgotten-credentials-link").click();
    await expect(page.getByTestId("recovery-password-submit")).toBeVisible();
  },
  "initial-password": async (page) => {
    await signIn(page, "bootstrap-admin", "password-submit");
  },
  "booking-dialog": async (page, visualDate) => {
    await selectVisualDate(page, visualDate);
    await page.locator('[data-testid="free-slot"][data-court-number="1"][data-slot="12:00"]').click();
    await expect(page.getByTestId("booking-dialog")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  "booking-kind": async (page) => {
    await expect(page.getByTestId("booking-card")).toBeVisible();
  },
  "booking-participants": async (page) => {
    await page.getByTestId("member-search").fill("Mary");
    await page.getByTestId("member-match").click();
    await page.getByTestId("booking-more-summary").click();
    await expect(page.getByTestId("guest-participants")).toBeVisible();
  },
  "my-bookings": async (page) => {
    await page.getByTestId("booking-submit").click();
    await expect(page.getByTestId("booking-dialog")).toHaveCount(0);
    await page.getByTestId("my-bookings-link").click();
    await expect(page.getByTestId("my-bookings-page")).toBeVisible();
    await expect(page.getByTestId("upcoming-bookings")).toBeVisible();
  },
  "participations": async (page) => {
    await expect(page.getByTestId("participations")).toBeVisible();
  },
  // A booking whose card has no players yet is refused before any rule is read, so the passage
  // about a rule needs a dialogue the card itself accepts.
  "refused-booking": async (page) => {
    await page.getByTestId("week-next").click();
    await page.getByTestId("week-next").click();
    await page.locator('[data-testid="free-slot"][data-court-number="1"][data-slot="12:00"]').first().click();
    await expect(page.getByTestId("booking-dialog")).toBeVisible();
    await page.getByTestId("member-search").fill("Mary");
    await page.getByTestId("member-match").click();
    await page.getByTestId("booking-submit").click();
    await expect(page.locator('[data-code="booking.rule.advanceWindow.exceeded"]')).toBeVisible();
    // The refusal also carries the reference a member would quote to their board, which is a
    // different string on every screen and belongs in no published picture.
    await page.evaluate(() => document.querySelector('[data-testid="booking-dialog"] [role="alert"]')?.remove());
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  "series-form": async (page) => {
    await page.getByTestId("my-bookings-link").click();
    await page.getByTestId("new-series").click();
    await expect(page.getByTestId("preview-series")).toBeVisible();
  },
  "notification-choices": async (page) => {
    await page.getByTestId("my-messages-link").click();
    await expect(page.getByTestId("my-messages-save")).toBeVisible();
  },
  "account-security": async (page) => {
    await page.getByTestId("preferences-menu").click();
    await page.getByTestId("account-security-link").click();
    await expect(page.getByTestId("current-password")).toBeVisible();
  },
  "admin-navigation": async (page) => {
    await page.getByTestId("administration-link").click();
    await expectAdministrationOverview(page);
  },
  // The bar appears only once something is unsaved, so a renamed court brings it on screen.
  "save-bar": async (page) => {
    await page.getByTestId("admin-courts-link").click();
    await page.locator('[data-testid^="edit-court-name-"]').first().fill("Centre Court");
    await expect(page.getByTestId("save-bar")).toBeVisible();
  },
  "admin-overview": async (page, visualDate) => {
    await onTheVisualDay(page, visualDate);
    await page.goto("/admin");
    await expectAdministrationOverview(page);
    await expect(page.getByTestId("overview-today-entry").first()).toBeVisible();
  },
  "admin-setup": async (page) => {
    await page.getByTestId("admin-setup-link").click();
    await expect(page.getByTestId("setup-progress")).toBeVisible();
  },
  "club-appearance": async (page) => {
    await page.getByTestId("admin-configuration-link").click();
    await expect(page.getByTestId("logo-url")).toBeEnabled();
  },
  "deadlines": async (page) => {
    await page.getByTestId("admin-deadlines-link").click();
    await expect(page.getByTestId("booking-reminder-hours")).toBeEnabled();
  },
  "booking-rules": async (page) => {
    await page.getByTestId("admin-rule-sets-link").click();
    await expect(page.getByTestId("rule-set-name")).toBeVisible();
  },
  "courts": async (page) => {
    await page.getByTestId("admin-courts-link").click();
    await expect(page.getByTestId("create-court")).toBeVisible();
  },
  "opening-hours": async (page) => {
    await page.getByTestId("admin-opening-hours-link").click();
    await expect(page.getByTestId("hours-open-MONDAY")).toBeEnabled();
  },
  "booking-card": async (page) => {
    await page.getByTestId("admin-booking-cards-link").click();
    await expect(page.getByTestId("create-card")).toBeVisible();
    await page.getByTestId(/^card-link-/).first().click();
    await expect(page.getByTestId("card-preview")).toBeVisible();
  },
  "slot-fillers": async (page) => {
    await page.getByTestId("admin-slot-fillers-link").click();
    await expect(page.getByTestId("create-participant-card")).toBeVisible();
  },
  "membership-types": async (page) => {
    await page.getByTestId("admin-membership-types-link").click();
    await expect(page.getByTestId("create-membership-type")).toBeVisible();
  },
  "admin-roster": async (page) => {
    await page.getByTestId("admin-roster-link").click();
    await expect(page.locator('[data-testid^="roster-row-"]').first()).toBeVisible();
  },
  // The first row of the roster is the bootstrap administrator, who holds no membership, and an
  // empty panel would illustrate the passage with the one person it is not about.
  "person-membership": async (page) => {
    await page.getByTestId("roster-search").fill("Jane");
    await page.getByTestId("roster-search-submit").click();
    await expect(page.locator('[data-testid^="roster-row-"]')).toHaveCount(2);
    await page.locator('[data-testid^="person-link-"]').first().click();
    await expect(page.getByTestId("end-membership")).toBeVisible();
  },
  "import-source": async (page) => {
    await page.getByTestId("admin-import-link").click();
    await page.getByTestId("new-source").click();
    await page.getByTestId("source-file").setInputFiles({
      name: "members.csv", mimeType: "text/csv", buffer: Buffer.from(MEMBER_LIST, "utf8")
    });
    await expect(page.getByTestId("column-EXTERNAL_ID")).toContainText("Number");
    await page.getByTestId("source-key").fill("club-registry");
    await page.getByTestId("source-name").fill("Club registry");
    await page.getByTestId("column-EXTERNAL_ID").selectOption("Number");
    await page.getByTestId("column-FIRST_NAME").selectOption("Given");
    await page.getByTestId("column-LAST_NAME").selectOption("Family");
    await page.getByTestId("column-EMAIL").selectOption("Mail");
    // The typed source brings the sticky save bar, which would otherwise cover a field mid-form.
    await page.setViewportSize({ width: 1280, height: 2000 });
    await expect(page.getByTestId("save-bar")).toBeVisible();
  },
  "utilisation": async (page, visualDate) => {
    await page.getByTestId("admin-utilisation-link").click();
    await expect(page.getByTestId("utilisation-row-1")).toBeVisible();
    const lastMonth = await page.getByTestId("utilisation-period").textContent() ?? "";
    await page.getByTestId("utilisation-from").fill(visualDate);
    await page.getByTestId("utilisation-to").fill(visualDate);
    await page.getByTestId("utilisation-read").click();
    await expect(page.getByTestId("utilisation-period")).not.toHaveText(lastMonth);
    await expect(page.getByTestId("utilisation-row-1")).toBeVisible();
  }
};

test("the court plan every visitor sees is captured", async ({ page, journeyService }, info) => {
  // given
  await prepare(page, localeOf(info));

  // when / then
  await capture(page, "court-plan", journeyService.visualDate);
});

test("every surface a member reaches without a password is captured", async ({ page, journeyService }, info) => {
  // given
  await prepare(page, localeOf(info));

  // when / then
  await capture(page, "sign-in", journeyService.visualDate);
  await capture(page, "account-recovery", journeyService.visualDate);
  await capture(page, "initial-password", journeyService.visualDate);
});

test("every surface a booking passes through is captured", async ({ page, journeyService }, info) => {
  // given
  await prepare(page, localeOf(info));
  await signIn(page, "doe.jane", "court-plan-view");

  // when / then
  await capture(page, "booking-dialog", journeyService.visualDate);
  await capture(page, "booking-kind", journeyService.visualDate);
  await capture(page, "booking-participants", journeyService.visualDate);
  await capture(page, "my-bookings", journeyService.visualDate);
  await capture(page, "participations", journeyService.visualDate);
});

test("the refusal a booking rule writes is captured", async ({ page, journeyService }, info) => {
  // given
  await prepare(page, localeOf(info));
  await signIn(page, "doe.jane", "court-plan-view");

  // when / then
  await capture(page, "refused-booking", journeyService.visualDate);
});

test("the series a trainer arranges is captured", async ({ page, journeyService }, info) => {
  // given
  await prepare(page, localeOf(info));
  await signIn(page, "trainer.doe", "court-plan-view");

  // when / then
  await capture(page, "series-form", journeyService.visualDate);
});

test("every surface a member decides about their own account on is captured", async ({ page, journeyService }, info) => {
  // given
  await prepare(page, localeOf(info));
  await signIn(page, "doe.jane", "court-plan-view");

  // when / then
  await capture(page, "notification-choices", journeyService.visualDate);
  await capture(page, "account-security", journeyService.visualDate);
});

test("every surface the club's own configuration shows is captured", async ({ page, journeyService }, info) => {
  // given
  await prepare(page, localeOf(info));
  await signIn(page, "configuration-admin", "court-plan-view");

  // when / then
  await capture(page, "admin-navigation", journeyService.visualDate);
  await capture(page, "admin-overview", journeyService.visualDate);
  await backAtTheJourneyInstant(page);
  await capture(page, "admin-setup", journeyService.visualDate);
  await capture(page, "club-appearance", journeyService.visualDate);
  await capture(page, "deadlines", journeyService.visualDate);
  await capture(page, "booking-rules", journeyService.visualDate);
});

test("every surface the facility is described on is captured", async ({ page, journeyService }, info) => {
  // given
  await prepare(page, localeOf(info));
  await signIn(page, "configuration-admin", "court-plan-view");
  await page.getByTestId("administration-link").click();

  // when / then
  await capture(page, "courts", journeyService.visualDate);
  await capture(page, "opening-hours", journeyService.visualDate);
  await capture(page, "booking-card", journeyService.visualDate);
  await capture(page, "slot-fillers", journeyService.visualDate);
  await capture(page, "save-bar", journeyService.visualDate);
});

test("every surface the members are kept on is captured", async ({ page, journeyService }, info) => {
  // given
  await prepare(page, localeOf(info));
  await signIn(page, "configuration-admin", "court-plan-view");
  await page.getByTestId("administration-link").click();

  // when / then
  await capture(page, "membership-types", journeyService.visualDate);
  await capture(page, "admin-roster", journeyService.visualDate);
  await capture(page, "person-membership", journeyService.visualDate);
});

test("the source a board reads its member list from is captured", async ({ page, journeyService }, info) => {
  // given
  await prepare(page, localeOf(info));
  await signIn(page, "configuration-admin", "court-plan-view");
  await page.getByTestId("administration-link").click();

  // when / then
  await capture(page, "import-source", journeyService.visualDate);
});

test("the record a board reads its own club from is captured", async ({ page, journeyService }, info) => {
  // given
  await prepare(page, localeOf(info));
  await signIn(page, "configuration-admin", "court-plan-view");
  await page.getByTestId("administration-link").click();

  // when / then
  await capture(page, "utilisation", journeyService.visualDate);
});

async function prepare(page: Page, locale: string): Promise<void> {
  await page.goto("/");
  await selectPreference(page, "#locale-preference", locale);
  await selectPreference(page, "#theme-preference", "light");
}

async function capture(page: Page, name: string, visualDate: string): Promise<void> {
  const declared = catalogue.captures.find((entry) => entry.name === name);
  if (declared === undefined) throw new Error(`No catalogue entry for ${name}`);
  await drivers[name](page, visualDate);
  const surface = page.getByTestId(declared.surface);
  await surface.page().evaluate(() => document.fonts.ready);
  await expect(surface).toHaveScreenshot(`${name}.png`, { animations: "disabled", caret: "hide" });
}

// A one-time password leads to the page that replaces it and nowhere else, so what the sign-in
// reaches is the account's own answer rather than always the plan.
async function signIn(page: Page, username: string, landing: string): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId(landing)).toBeVisible();
}

async function selectVisualDate(page: Page, date: string): Promise<void> {
  await expect(page.getByTestId("week-grid")).toBeVisible();
  const day = page.getByTestId(`day-selector-${date}`);
  if (await day.count() === 0) {
    await page.getByTestId("week-next").click();
  }
  await day.click();
}

async function expectDesktopCourtPlanToFit(page: Page): Promise<void> {
  const layout = await page.getByTestId("court-plan-view").evaluate((plan) => {
    const planBounds = plan.getBoundingClientRect();
    const elements = [
      plan.querySelector('[data-testid="week-date"]'),
      ...plan.querySelectorAll('[data-testid^="day-selector-"]'),
      plan.querySelector('[data-testid="week-grid"]')
    ].filter((element): element is Element => element !== null);
    return {
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      elementsFit: elements.every((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= planBounds.left && bounds.right <= planBounds.right;
      })
    };
  });
  expect(layout).toEqual({ documentFits: true, elementsFit: true });
}
