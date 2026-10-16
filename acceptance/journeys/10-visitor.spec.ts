import { test, expect } from "@playwright/test";
import { capture } from "../lib/checks";
import { openAs } from "../lib/session";
import { step } from "../lib/steps";
import { gotoDay } from "../lib/plan";
import { lanePlan } from "../lib/lanes";

test("when a visitor reads the plan, the sign-in and the recovery page, then every surface renders cleanly", async ({ browser }) => {
  // when
  const page = await openAs(browser, "visitor");
  await step("visitor", "plan today", () => capture(page, "plan-today"));
  await step("visitor", "plan in window", async () => { await gotoDay(page, lanePlan().saturday); await capture(page, "plan-signed-out"); });
  await step("visitor", "sign-in notice", async () => {
    await expect(page.getByTestId("guest-guidance"), "product: the plan tells a visitor how to book").toBeVisible();
    expect(await page.getByRole("heading", { level: 1 }).count(), "product: the plan carries exactly one page heading").toBe(1);
    await page.getByTestId("guest-sign-in").click();
    await expect(page.getByTestId("login-view"), "product: the notice's action opens the sign-in").toBeVisible();
    await page.goBack();
    await expect(page.getByTestId("guest-guidance")).toBeVisible();
  });
  // then — each page renders and is captured
  await step("visitor", "sign-in page", async () => {
    await page.getByTestId("sign-in-link").click();
    await expect(page.getByTestId("login-view")).toBeVisible();
    await capture(page, "login");
  });
  await step("visitor", "recovery page", async () => {
    await page.getByTestId("forgotten-credentials-link").click();
    await expect(page.getByTestId("account-recovery-view")).toBeVisible();
    await capture(page, "account-recovery");
  });
  await page.context().close();
});
