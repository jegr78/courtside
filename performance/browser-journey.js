const GUEST_NAME = "Browser Test Guest";

export async function prepareBrowserBooking(page, courtNumber) {
  const placeholders = page.locator('div[data-testid="free-slot"]').nth(0);
  await placeholders.waitFor({ state: "detached" });
  const slot = (date) => `button[data-testid="free-slot"][data-court-number="${courtNumber}"][data-date="${date}"]:not([disabled])`;
  // Today's next slot can start before the dialog is submitted, so the journey books from tomorrow on.
  let date = await selectAvailableDay(page, slot, false);
  if (!date) {
    const firstDay = await page.locator('button[data-testid^="day-selector-"]').nth(0).getAttribute("data-testid");
    const nextMonday = new Date(`${firstDay.slice("day-selector-".length)}T00:00:00Z`);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
    await page.getByTestId("week-next").click();
    await page.getByTestId(`day-selector-${nextMonday.toISOString().slice(0, 10)}`).waitFor();
    await placeholders.waitFor({ state: "detached" });
    date = await selectAvailableDay(page, slot, true);
    if (!date) throw new Error("No enabled booking slot in the bounded two-week search");
  }
  await page.locator(slot(date)).nth(0).click();
  // The loaded cards add the player count line, which shifts the centred dialog under a pending click.
  await page.locator('[data-testid="booking-card"] option').nth(0).waitFor({ state: "attached" });
  await page.getByTestId("booking-more-summary").click();
  await page.locator('details[data-testid="booking-more"][open]').waitFor();
  const guest = page.getByTestId("guest-name");
  await guest.waitFor({ state: "visible" });
  await guest.fill(GUEST_NAME);
  const entered = await guest.inputValue();
  if (entered !== GUEST_NAME) throw new Error(`The guest field holds ${JSON.stringify(entered)} after entering "${GUEST_NAME}"`);
}

async function selectAvailableDay(page, slot, includeSelected) {
  const days = page.locator('button[data-testid^="day-selector-"]');
  const count = await days.count();
  const dateOf = (id) => id.slice("day-selector-".length);
  let selected = -1;
  for (let index = 0; index < count; index++) {
    if (await days.nth(index).getAttribute("aria-pressed") === "true") { selected = index; break; }
  }
  if (includeSelected && selected >= 0) {
    const date = dateOf(await days.nth(selected).getAttribute("data-testid"));
    if (await page.locator(slot(date)).count() > 0) return date;
  }
  for (let index = selected + 1; index < count; index++) {
    const id = await days.nth(index).getAttribute("data-testid");
    await days.nth(index).click();
    await page.locator(`button[data-testid="${id}"][aria-pressed="true"]`).waitFor();
    if (await page.locator(slot(dateOf(id))).count() > 0) return dateOf(id);
  }
  return null;
}
