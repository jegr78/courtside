import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await page.getByTestId("my-bookings-link").click();
}

test("sport and youth directors find the same managed league match", async ({ page }) => {
  for (const username of ["sport.major", "youth.miles"]) {
    // given
    await signIn(page, username);

    // when / then
    await expect(page.getByRole("heading", { name: "Managed appointments" })).toBeVisible();
    const leagueMatch = page.locator("article").filter({
      has: page.locator('[data-booking-id="70000000-0000-0000-0000-000000000004"]')
    });
    await expect(leagueMatch).toBeVisible();
    await leagueMatch.getByRole("button", { name: "Details" }).click();
    await expect(page.getByTestId("managed-note")).toContainText("Prepare score sheets");
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await page.getByTestId("logout").click();
  }
});

test("an authorized officer cancels a managed appointment through the browser", async ({ page }) => {
  // given
  await signIn(page, "sport.major");
  const bookingId = "70000000-0000-0000-0000-000000000006";
  const cancel = page.locator(`[data-testid="managed-cancel"][data-booking-id="${bookingId}"]`);

  // when
  await cancel.click();
  await page.getByTestId("confirm-cancellation").click();

  // then
  await expect(cancel).not.toBeVisible();
  await expect(page.getByTestId(`booking-${bookingId}`)).toHaveAttribute("data-status", "CANCELLED");
});

test("an ordinary member has no managed-appointments area", async ({ page }) => {
  // when
  await signIn(page, "doe.jane");

  // then
  await expect(page.getByRole("heading", { name: "Managed appointments" })).not.toBeVisible();
});
