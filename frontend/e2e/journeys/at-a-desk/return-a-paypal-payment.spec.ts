import { expect, test } from "../../fixtures";
import { credentialIn, messageWith } from "../../mailbox";
import { activate, openTheApplication, openTheSlot, reachAdministration, signIn, signOut, walks, writeInto } from "../../journey-walking";

test("given an external player who paid a court at PayPal and cancelled it, when the treasurer returns the payment through PayPal, then the ledger takes the credit back and the payment cannot be returned twice",
  walks("session-and-own-account", "booking-rules-and-club-configuration", "facility-card-and-membership-configuration",
    "roster-membership-and-account-administration", "paypal-settings", "booking-participation-and-series", "paypal-checkout",
    "credit-ledger", "paypal-refund"),
  async ({ page, language, journeyService }) => {
    // given: the club takes PayPal from outsiders and the player has an account
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

    await reachAdministration(page, "admin-roster-link");
    await writeInto(page.getByTestId("new-person-first-name"), "John");
    await writeInto(page.getByTestId("new-person-last-name"), "Roe");
    await writeInto(page.getByTestId("new-person-email"), "john.roe+refund@example.org");
    await activate(page.getByTestId("create-person"));
    await expect(page.getByTestId("admin-person-view")).toBeVisible();
    await writeInto(page.getByTestId("new-account-username"), "roe.john.refund");
    await activate(page.getByTestId("new-account-role-EXTERNAL"));
    await activate(page.getByTestId("create-account"));
    await expect(page.getByTestId("account-username")).toHaveValue("roe.john.refund");
    await signOut(page);

    const mailed = await messageWith(journeyService.mailboxURL, "john.roe+refund@example.org", "Einmalpasswort:");
    await signIn(page, "roe.john.refund", credentialIn(mailed, "Einmalpasswort:"));
    await expect(page.getByTestId("initial-password-view")).toBeVisible();
    await writeInto(page.getByTestId("new-password"), "the-visitor-picked-this");
    await writeInto(page.getByTestId("confirm-password"), "the-visitor-picked-this");
    await activate(page.getByTestId("password-submit"));
    await signIn(page, "roe.john.refund", "the-visitor-picked-this");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();

    // and the player pays the day's last free court at PayPal and cancels it before it starts
    await openTheSlot(page, page.locator('[data-testid="free-slot"][data-state="free"]').last());
    await activate(page.getByTestId("booking-submit"));
    await expect(page.getByTestId("paypal-stub"), "the player stands at PayPal").toBeVisible();
    await activate(page.getByTestId("paypal-stub-approve"));
    await expect(page.getByTestId("paypal-outcome")).toHaveAttribute("data-outcome", "CONFIRMED");
    const toBooking = page.getByTestId("paypal-to-bookings");
    const bookingId = (await toBooking.getAttribute("href"))?.split("#booking-")[1];
    expect(bookingId, "the return names the paid booking").toBeTruthy();
    await activate(toBooking);
    const cancel = page.locator(`[data-testid="personal-cancel"][data-booking-id="${bookingId}"]`);
    await activate(cancel);
    await activate(page.getByTestId("confirm-cancellation"));
    await expect(cancel, "the cancelled court left the player's bookings").toHaveCount(0);
    await signOut(page);

    // when: the treasurer opens the player's credit and returns the payment
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await reachAdministration(page, "admin-credit-link");
    await expect(page.getByTestId("admin-credit-view")).toBeVisible();
    await writeInto(page.getByTestId("credit-search"), "roe.john.refund");
    await activate(page.getByTestId("credit-holder-open"));
    await expect(page.getByTestId("credit-balance"), "the cancelled half hour at 18.00 an hour left 9.00 as credit")
      .toHaveAttribute("data-balance-minor", "900");
    await activate(page.getByTestId("paypal-refund"));
    await activate(page.getByTestId("paypal-refund-confirm"));

    // then
    await expect(page.getByTestId("paypal-refund-outcome")).toBeVisible();
    await expect(page.getByTestId("credit-balance"), "the returned payment is no longer credit").toHaveAttribute("data-balance-minor", "0");
    const refund = page.locator('[data-testid="credit-entry"][data-kind="PAYPAL_REFUND"]');
    await expect(refund, "the ledger carries one refund line").toHaveCount(1);
    await expect(refund.getByTestId("paypal-refund-state")).toHaveAttribute("data-status", "COMPLETED");
    await expect(page.getByTestId("paypal-refund"), "a returned payment offers no second return").toHaveCount(0);
  });
