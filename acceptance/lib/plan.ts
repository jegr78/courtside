import { expect, type Locator, type Page } from "@playwright/test";
import { lanePlan } from "./lanes";

export const inWindow = (date: string | null) => date !== null && lanePlan().days.includes(date);

export async function gotoDay(page: Page, date: string) {
  if (!inWindow(date)) throw new Error(`refusing to leave the booking window: ${date}`);
  const day = page.getByTestId(`day-selector-${date}`);
  const next = page.getByTestId("week-next").or(page.getByTestId("mobile-week-next")).filter({ visible: true }).first();
  await expect(page.getByTestId("day-plan-table")).toBeVisible();
  for (let hop = 0; hop < 9 && !(await day.isVisible()); hop++) {
    const shown = await page.locator('[data-testid^="day-selector-"]').first().getAttribute("data-testid");
    await next.click();
    await expect(page.locator('[data-testid^="day-selector-"]').first()).not.toHaveAttribute("data-testid", shown!);
  }
  await day.click();
  await expect(day).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`[data-testid="free-slot"][data-date="${date}"], [data-testid="outside-slot"][data-date="${date}"], [data-testid="day-closed"], [data-testid="day-closed-notice"]`).first()).toBeAttached();
}

export async function pickFreeSlot(page: Page, court?: number, from = 0): Promise<Locator | null> {
  for (const date of lanePlan().days.slice(from)) {
    await gotoDay(page, date);
    const filter = court ? `[data-court-number="${court}"]` : "";
    const slot = page.locator(`button[data-testid="free-slot"][data-state="free"][data-date="${date}"]${filter}`).first();
    if (await slot.count() > 0 && inWindow(await slot.getAttribute("data-date"))) return slot;
  }
  return null;
}
