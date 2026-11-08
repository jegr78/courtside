import { expect, test } from "../../fixtures";
import { activate, openTheApplication, reachAdministration, signIn, walks, writeInto } from "../../journey-walking";

test("given a club that wants to accept PayPal, when the treasurer stores the credentials and later removes them, then the secret is never shown again and nothing remains",
  walks("session-and-own-account", "paypal-settings"),
  async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await reachAdministration(page, "admin-paypal-link");
    await expect(page.getByTestId("admin-paypal-view")).toBeVisible();
    await expect(page.getByTestId("paypal-secret-state")).toHaveAttribute("data-stored", "false");

    // when
    await writeInto(page.getByTestId("paypal-client-id"), "example-sandbox-client");
    await writeInto(page.getByTestId("paypal-secret"), "example-sandbox-secret");
    await activate(page.getByTestId("paypal-enabled"));
    await activate(page.getByTestId("paypal-save"));

    // then
    await expect(page.getByTestId("paypal-form-success")).toBeVisible();
    await expect(page.getByTestId("paypal-secret-state")).toHaveAttribute("data-stored", "true");
    await expect(page.getByTestId("paypal-secret"), "the stored secret is never put back into the page").toHaveValue("");
    await page.reload();
    await expect(page.getByTestId("paypal-client-id")).toHaveValue("example-sandbox-client");
    await expect(page.getByTestId("paypal-secret")).toHaveValue("");

    // when
    await activate(page.getByTestId("paypal-remove"));
    await activate(page.getByTestId("paypal-remove-confirm"));

    // then
    await expect(page.getByTestId("paypal-secret-state")).toHaveAttribute("data-stored", "false");
    await expect(page.getByTestId("paypal-client-id")).toHaveValue("");
  });
