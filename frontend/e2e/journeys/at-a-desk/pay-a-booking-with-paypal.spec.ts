import { expect, test } from "../../fixtures";
import { credentialIn, messageWith } from "../../mailbox";
import { activate, openTheApplication, openTheSlot, reachAdministration, signIn, signOut, walks, writeInto } from "../../journey-walking";

test("given a club that takes PayPal and an external player without credit, when the player pays one booking at PayPal and turns back from another, then the first court is theirs and the second is free again at once",
  walks("session-and-own-account", "booking-rules-and-club-configuration", "facility-card-and-membership-configuration",
    "roster-membership-and-account-administration", "paypal-settings", "booking-participation-and-series", "paypal-checkout"),
  async ({ page, language, journeyService }) => {
    // given: the board opens the club to outsiders, prices a card for them and switches PayPal on
    await openTheApplication(page, language);
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await reachAdministration(page, "admin-configuration-link");
    await expect(page.getByTestId("admin-configuration-view")).toBeVisible();
    await activate(page.getByTestId("config-external-bookings"));
    await activate(page.getByTestId("save-club-config"));
    await expect(page.getByTestId("admin-save-success")).toBeVisible();

    await reachAdministration(page, "admin-booking-cards-link");
    await expect(page.getByTestId("admin-booking-cards-view")).toBeVisible();
    await writeInto(page.getByTestId("new-card-label"), "Visitor hour");
    await activate(page.getByTestId("new-card-role-EXTERNAL"));
    await writeInto(page.getByTestId("new-card-external-price"), language === "de" ? "18,00" : "18.00");
    await activate(page.getByTestId("create-card"));
    await expect(page.getByTestId("admin-booking-card-view")).toBeVisible();

    await reachAdministration(page, "admin-paypal-link");
    await expect(page.getByTestId("admin-paypal-view")).toBeVisible();
    await writeInto(page.getByTestId("paypal-client-id"), "example-sandbox-client");
    await activate(page.getByTestId("paypal-environment-SANDBOX"));
    await writeInto(page.getByTestId("paypal-secret"), "example-sandbox-secret");
    await activate(page.getByTestId("paypal-enabled"));
    await activate(page.getByTestId("paypal-save"));
    await expect(page.getByTestId("paypal-form-success")).toBeVisible();
    await expect(page.getByTestId("paypal-sandbox-warning"), "the board is told that sandbox bookings are paid with test money")
      .toBeVisible();

    // and the player has an account of their own
    await reachAdministration(page, "admin-roster-link");
    await writeInto(page.getByTestId("new-person-first-name"), "John");
    await writeInto(page.getByTestId("new-person-last-name"), "Roe");
    await writeInto(page.getByTestId("new-person-email"), "john.roe+paypal@example.org");
    await activate(page.getByTestId("create-person"));
    await expect(page.getByTestId("admin-person-view")).toBeVisible();
    await writeInto(page.getByTestId("new-account-username"), "roe.john.paypal");
    await activate(page.getByTestId("new-account-role-EXTERNAL"));
    await activate(page.getByTestId("create-account"));
    await expect(page.getByTestId("account-username")).toHaveValue("roe.john.paypal");
    await signOut(page);

    const mailed = await messageWith(journeyService.mailboxURL, "john.roe+paypal@example.org", "Einmalpasswort:");
    await signIn(page, "roe.john.paypal", credentialIn(mailed, "Einmalpasswort:"));
    await expect(page.getByTestId("initial-password-view")).toBeVisible();
    await writeInto(page.getByTestId("new-password"), "the-visitor-picked-this");
    await writeInto(page.getByTestId("confirm-password"), "the-visitor-picked-this");
    await activate(page.getByTestId("password-submit"));
    await signIn(page, "roe.john.paypal", "the-visitor-picked-this");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();

    // when: the player books a court and pays for it at PayPal
    const paid = await openTheSlot(page, page.locator('[data-testid="free-slot"][data-state="free"]').first());
    await expect(page.getByTestId("booking-paypal-hint")).toBeVisible();
    await expect(page.getByTestId("booking-submit")).toHaveAttribute("data-payment", "PAYPAL");
    await activate(page.getByTestId("booking-submit"));
    await expect(page.getByTestId("paypal-stub"), "the player stands at PayPal").toBeVisible();
    await activate(page.getByTestId("paypal-stub-approve"));

    // then
    await expect(page.getByTestId("paypal-outcome")).toHaveAttribute("data-outcome", "CONFIRMED");
    const toBooking = page.getByTestId("paypal-to-bookings");
    const bookingId = (await toBooking.getAttribute("href"))?.split("#booking-")[1];
    expect(bookingId, "the return names the paid booking").toBeTruthy();
    await activate(toBooking);
    const row = page.getByTestId(`booking-${bookingId}`);
    await expect(row, "My bookings shows the paid booking as confirmed").toHaveAttribute("data-status", "CONFIRMED");
    await expect(row.getByTestId("booking-payment-pending"), "a paid booking no longer counts down its hold").toHaveCount(0);
    await activate(page.getByTestId("court-plan-link"));
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await expect(paid, "the paid court is no longer free").toHaveCount(0);

    // when: the player books another court and turns back at PayPal
    const abandoned = await openTheSlot(page, page.locator('[data-testid="free-slot"][data-state="free"]').first());
    await activate(page.getByTestId("booking-submit"));
    await expect(page.getByTestId("paypal-stub")).toBeVisible();
    await activate(page.getByTestId("paypal-stub-cancel"));

    // then
    await expect(page.getByTestId("paypal-outcome")).toHaveAttribute("data-outcome", "REJECTED");
    await activate(page.getByTestId("court-plan-link"));
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await expect(abandoned, "the court nobody paid for is free again").toHaveCount(1);
    await expect(paid).toHaveCount(0);
  });
