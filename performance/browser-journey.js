export async function prepareBrowserBooking(page, courtNumber) {
  await page.locator('div[data-testid="free-slot"]').nth(0).waitFor({ state: "detached" });
  const selector = `button[data-testid="free-slot"][data-court-number="${courtNumber}"]:not([disabled])`;
  if (!await selectAvailableDay(page, selector)) {
    const firstDay = await page.locator('button[data-testid^="day-selector-"]').nth(0).getAttribute("data-testid");
    const nextMonday = new Date(`${firstDay.slice("day-selector-".length)}T00:00:00Z`);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
    await page.getByTestId("week-next").click();
    await page.getByTestId(`day-selector-${nextMonday.toISOString().slice(0, 10)}`).waitFor();
    if (!await selectAvailableDay(page, selector)) throw new Error("No enabled booking slot in the bounded two-week search");
  }
  await page.locator(selector).nth(0).click();
  await page.getByTestId("booking-more-summary").click();
  await page.getByTestId("guest-name").waitFor({ state: "visible" });
  await page.getByTestId("guest-name").fill("Browser Test Guest");
}

async function selectAvailableDay(page, selector) {
  if (await page.locator(selector).count() > 0) return true;
  const days = page.locator('button[data-testid^="day-selector-"]');
  const count = await days.count();
  let selected = -1;
  for (let index = 0; index < count; index++) {
    if (await days.nth(index).getAttribute("aria-pressed") === "true") { selected = index; break; }
  }
  for (let index = selected + 1; index < count; index++) {
    const id = await days.nth(index).getAttribute("data-testid");
    await days.nth(index).click();
    await page.locator(`button[data-testid="${id}"][aria-pressed="true"]`).waitFor();
    if (await page.locator(selector).count() > 0) return true;
  }
  return false;
}
