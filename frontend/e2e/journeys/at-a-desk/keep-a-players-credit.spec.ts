import { expect, test } from "../../fixtures";
import { activate, openTheApplication, reachAdministration, signIn, walks, writeInto } from "../../journey-walking";

test("given an external player who paid cash at the clubhouse, when the treasurer credits it and later pays part of it out, then the ledger keeps both entries and the balance between them",
  walks("session-and-own-account", "roster-membership-and-account-administration", "credit-ledger"),
  async ({ page, language }) => {
    // given — the player has an external account
    await openTheApplication(page, language);
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await reachAdministration(page, "admin-roster-link");
    await writeInto(page.getByTestId("new-person-first-name"), "John");
    await writeInto(page.getByTestId("new-person-last-name"), "Roe");
    await writeInto(page.getByTestId("new-person-email"), "john.roe+credit@example.org");
    await activate(page.getByTestId("create-person"));
    await expect(page.getByTestId("admin-person-view")).toBeVisible();
    await writeInto(page.getByTestId("new-account-username"), "roe.john.credit");
    await activate(page.getByTestId("new-account-role-EXTERNAL"));
    await activate(page.getByTestId("create-account"));
    await expect(page.getByTestId("account-username")).toHaveValue("roe.john.credit");

    // when — the treasurer finds the account and credits the cash
    await reachAdministration(page, "admin-credit-link");
    await expect(page.getByTestId("admin-credit-view")).toBeVisible();
    await writeInto(page.getByTestId("credit-search"), "roe.john.credit");
    await activate(page.getByTestId("credit-holder-open"));
    await expect(page.getByTestId("credit-form")).toBeVisible();
    await page.getByTestId("credit-form-kind").selectOption("CREDIT");
    await writeInto(page.getByTestId("credit-form-amount"), language === "de" ? "20,00" : "20.00");
    await writeInto(page.getByTestId("credit-form-note"), "Cash at the clubhouse");
    await activate(page.getByTestId("credit-form-submit"));

    // then
    await expect(page.getByTestId("credit-entry")).toHaveCount(1);
    await expect(page.getByTestId("credit-balance")).toHaveAttribute("data-balance-minor", "2000");

    // when — part of it goes back to the player
    await page.getByTestId("credit-form-kind").selectOption("PAYOUT");
    await writeInto(page.getByTestId("credit-form-amount"), language === "de" ? "5,00" : "5.00");
    await writeInto(page.getByTestId("credit-form-note"), "Paid back in cash");
    await activate(page.getByTestId("credit-form-submit"));

    // then
    await expect(page.getByTestId("credit-entry")).toHaveCount(2);
    await expect(page.getByTestId("credit-balance")).toHaveAttribute("data-balance-minor", "1500");
  });
