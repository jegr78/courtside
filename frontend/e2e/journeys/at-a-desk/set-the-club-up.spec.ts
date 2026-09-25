import { expect, test } from "../../fixtures";
import { activate, journeyFile, openTheApplication, reachAdministration, rewrite, signIn, walks, writeInto, writeTime } from "../../journey-walking";

// The club this journey installs into is the one the migrations ship and nothing else: a
// bootstrap administrator holding a one-time password, the cards, one court, and no members.
test.use({ start: "empty" });

const WEEK = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

test("given a volunteer installing Courtside for their club on the evening it arrives, when they replace the password they were given and describe the club, its courts, its hours, its cards and its rules, then the club is open for its members without anybody touching a database",
  walks("session-and-own-account", "booking-rules-and-club-configuration",
    "facility-card-and-membership-configuration"), async ({ page, language }) => {
    // given — the password the instance was started with is not one to keep
    await openTheApplication(page, language);
    await signIn(page, "bootstrap-admin");
    await expect(page.getByTestId("initial-password-view")).toBeVisible();
    await writeInto(page.getByTestId("new-password"), "the-one-the-club-chose");
    await writeInto(page.getByTestId("confirm-password"), "the-one-the-club-chose");
    await activate(page.getByTestId("password-submit"));
    await signIn(page, "bootstrap-admin", "the-one-the-club-chose");

    // then — the club is shown what is still missing
    await expect(page.getByTestId("admin-overview-view")).toBeVisible();
    await expect(page.getByTestId("overview-setup").getByTestId("setup-progress")).toBeVisible();

    // when — the club says who it is and where it is
    await reachAdministration(page, "admin-configuration-link");
    await expect(page.getByTestId("admin-configuration-view")).toBeVisible();
    await rewrite(page.getByTestId("club-name"), "Example Racquet Club");
    await page.getByTestId("time-zone").selectOption("Europe/Berlin");
    await page.getByTestId("logo-file").setInputFiles(journeyFile("club-logo.png"));
    await activate(page.getByTestId("upload-logo"));
    await expect(page.getByTestId("remove-logo")).toBeVisible();
    await activate(page.getByTestId("save-club-config"));
    await expect(page.getByTestId("admin-save-success")).toBeVisible();

    // and what its members may do
    await reachAdministration(page, "admin-rule-sets-link");
    const firstRuleSet = page.getByTestId("rule-set-overview").getByRole("button").first();
    await activate(firstRuleSet);
    await expect(firstRuleSet).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("rule-set-name")).toBeVisible();

    // when — the courts it has
    await reachAdministration(page, "admin-courts-link");
    await expect(page.getByTestId("admin-courts-view")).toBeVisible();
    await writeInto(page.getByTestId("new-court-number"), "2");
    await writeInto(page.getByTestId("new-court-name"), "Centre Court");
    await activate(page.getByTestId("create-court"));

    // then
    await expect(page.locator('[data-testid^="court-row-"]')).toHaveCount(2);

    // when — the hours it opens them, which differ from the week it was shipped with
    await reachAdministration(page, "admin-opening-hours-link");
    await expect(page.getByTestId("hours-open-MONDAY")).toBeVisible();
    await writeTime(page.getByTestId("apply-opens-at"), "07:00");
    await writeTime(page.getByTestId("apply-closes-at"), "21:00");
    for (const day of WEEK) await activate(page.getByTestId(`apply-day-${day}`));
    await activate(page.getByTestId("apply-hours"));
    await activate(page.getByTestId("save-opening-hours"));

    // then
    await expect(page.getByTestId("admin-save-success")).toBeVisible();

    // when — a card of its own beside the ones it was shipped
    await reachAdministration(page, "admin-booking-cards-link");
    await expect(page.getByTestId("admin-booking-cards-view")).toBeVisible();
    await writeInto(page.getByTestId("new-card-label"), "Club evening");
    await activate(page.getByTestId("create-card"));

    // then — the club is put on the card it just made, which is where it would go on to describe it
    await expect(page.getByTestId("admin-booking-card-view")).toBeVisible();
    await expect(page.getByTestId("card-label")).toHaveValue("Club evening");

    // when — and what else may be on a court
    await reachAdministration(page, "admin-slot-fillers-link");
    await expect(page.getByTestId("admin-slot-fillers-view")).toBeVisible();
    await writeInto(page.getByTestId("new-participant-card-label"), "Practice wall");
    await writeInto(page.getByTestId("new-participant-card-capacity"), "1");
    await activate(page.getByTestId("create-participant-card"));

    // then
    await expect(page.locator('[data-testid^="participant-card-row-"]').first()).toBeVisible();
  });
