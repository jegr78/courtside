import { expect, test } from "../fixtures";
import { activate, openTheApplication, writeInto } from "../journey-walking";

test("given a member with an account, when they open the application and book a court with a co-player, then the booking stands in the plan", async ({ page }) => {
  // given
  await openTheApplication(page);
  await expect(page.getByTestId("public-club-name")).toBeVisible();

  // when
  await activate(page.getByTestId("sign-in-link"));
  await expect(page.getByTestId("login-view")).toBeVisible();
  await writeInto(page.getByTestId("username"), "doe.jane");
  await writeInto(page.getByTestId("password"), "temporary-password");
  await activate(page.getByTestId("login-submit"));

  // then
  await expect(page.getByTestId("court-plan-view")).toBeVisible();

  // when
  const slot = page.locator('[data-testid="free-slot"][data-state="free"]').first();
  await activate(slot);

  // then
  await expect(page.getByTestId("booking-dialog")).toBeVisible();

  // when
  await writeInto(page.getByTestId("member-search"), "Major");
  const match = page.getByTestId("member-match").first();
  await expect(match).toBeVisible();
  await activate(match);
  await activate(page.getByTestId("booking-submit"));

  // then
  await expect(page.getByTestId("booking-dialog")).not.toBeVisible();
  await expect(page.getByTestId("own-allocation").first()).toBeVisible();
});
