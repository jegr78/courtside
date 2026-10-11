import { runPath } from "./context";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { capture } from "./checks";
import { recordCreated } from "./ledger";
import { gotoDay } from "./plan";
import type { Slot } from "./lanes";
import { xsrf } from "./session";

let loaded: Record<string, any> | undefined;
// Read on first use: the discovery project writes the file after this module is first imported.
export const discovery: Record<string, any> = new Proxy({}, { get: (_target, key: string) => (loaded ??= JSON.parse(readFileSync(runPath("discovery.json"), "utf8")))[key] });
export const projectName = () => test.info().project.name;
export const onPhonesAndChrome = () => /iphone|pixel|narrow|desktop-chrome|desktop-firefox/.test(projectName());
export const onDesksAndTablet = () => /desktop|ipad|pixel-7/.test(projectName());

export async function submitBooking(page: Page, who: string) {
  const created = page.waitForResponse((r) => r.url().endsWith("/api/bookings") && r.request().method() === "POST");
  await page.getByTestId("booking-submit").click();
  const response = await created;
  const body = await response.json().catch(() => ({}));
  if (response.ok() && body.id) recordCreated({ kind: "booking", id: body.id, by: who, project: projectName() });
  return { status: response.status(), id: body.id as string | undefined, body };
}

export async function openSlot(page: Page, slot: Slot) {
  await gotoDay(page, slot.date);
  const cell = page.locator(`button[data-testid="free-slot"][data-date="${slot.date}"][data-court-number="${slot.court}"][data-slot="${slot.start}"]`);
  // The sweep has already confirmed the slot free through the API, so a plan that disagrees is a product answer.
  expect(await cell.count() === 1 && await cell.getAttribute("data-state") === "free",
    `product: slot ${slot.journey} ${slot.date} ${slot.start} court ${slot.court} is offered as free`).toBe(true);
  await cell.click();
  await expect(page.getByTestId("booking-dialog")).toBeVisible();
}

export async function bookAt(page: Page, who: string, slot: Slot, fill: (page: Page) => Promise<void>, options: { card?: string } = {}) {
  await openSlot(page, slot);
  await capture(page, "booking-dialog");
  if (options.card) await page.getByTestId("booking-card").selectOption(options.card);
  await fill(page);
  await capture(page, "booking-dialog-filled");
  const result = await submitBooking(page, who);
  expect(result.status, `product: the booking in ${slot.journey} is accepted (${JSON.stringify(result.body)})`).toBeLessThan(300);
  await expect(page.getByTestId("booking-dialog"), "product: the dialog closes after an accepted booking").not.toBeVisible();
  return result.id!;
}

export async function cancelQuietly(page: Page, ids: string[]) {
  try {
    const token = await xsrf(page);
    for (const id of ids) await page.request.delete(`/api/bookings/${id}`, { headers: { "X-XSRF-TOKEN": token } });
  } catch { /* the slot sweep cancels what a closed context could not */ }
}

export async function addPartner(page: Page, key: string) {
  await page.getByTestId("member-search").fill(discovery.lastNames[key]);
  await page.getByTestId("member-match").first().click();
}
