import { expect, test } from "../../fixtures";
import { activate, openTheApplication, reachAdministration, signIn, walks } from "../../journey-walking";

test("given a club whose gates take a code per booking, when the board checks the access-control system, then the next pass answers on the access grants page",
  walks("session-and-own-account", "access-grant-administration"),
  async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await expect(page.getByTestId("admin-shell")).toBeVisible();

    // when
    await reachAdministration(page, "admin-access-grants-link");

    // then — the page names the system and never a code
    await expect(page.getByTestId("admin-access-grants-view")).toBeVisible();
    await expect(page.getByTestId("access-grants-connector")).toContainText("simulated");

    // when — the board asks for a fresh check
    await activate(page.getByTestId("access-grants-probe-now"));

    // then — the worker's next pass answers it
    await expect(page.getByTestId("access-grants-probe-requested")).toBeVisible();
    await expect(async () => {
      await activate(page.getByTestId("access-grants-refresh"));
      await expect(page.getByTestId("access-grants-probe")).toHaveAttribute("data-outcome", "ANSWERED", { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
  });
