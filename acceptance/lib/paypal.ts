import { expect, type Locator, type Page } from "@playwright/test";
import type { Api } from "./api";
import { fillSecret } from "./secret-fill";

export type CreditEntry = { kind: string; amountMinor: number; bookingId: string | null; paypalOrderId: string | null };
export type Credit = { balanceMinor: number; currency: string; items: CreditEntry[] };
export type ExternalCard = { id: string; active: boolean; allowedRoles: string[]; externalPriceMinor?: number; allowedPlayerCounts: number[] };

const PAY = /^(Zahlen|Jetzt zahlen|Pay|Pay Now|Complete Purchase)$/i;

export const externalCard = (cards: ExternalCard[]) => cards.find((card) => card.active && card.allowedRoles.includes("EXTERNAL")
  && (card.externalPriceMinor ?? 0) > 0 && card.allowedPlayerCounts.length === 0);

export async function creditOf(player: Api): Promise<Credit> {
  return await (await player.get("/api/my/credit?limit=50")).json() as Credit;
}

async function settle(clicked: Locator) {
  await expect(clicked).toBeHidden({ timeout: 30_000 }).catch(() => undefined);
}

// PayPal's own pages: their steps are found by PayPal's ids and the pay button's name, never by Courtside's test ids.
export async function approveAtPayPal(page: Page, origin: string, buyer: { buyer: string; password: string }) {
  await page.waitForURL((url) => url.origin !== origin, { timeout: 30_000 });
  for (let step = 0; step < 12 && new URL(page.url()).origin !== origin; step++) {
    const cookies = page.locator("#acceptAllButton").filter({ visible: true });
    const email = page.locator("#email").filter({ visible: true });
    const password = page.locator("#password").filter({ visible: true });
    const pay = page.getByRole("button", { name: PAY }).filter({ visible: true });
    await expect(cookies.or(email).or(password).or(pay).first(), "the PayPal checkout shows a step the harness knows").toBeVisible({ timeout: 30_000 });
    if (await cookies.count()) {
      await cookies.first().click();
      await settle(cookies.first());
    } else if (await email.count() && await email.inputValue() === "") {
      await email.fill(buyer.buyer);
      await page.locator("#btnNext").click();
      await expect(password.or(pay).first()).toBeVisible({ timeout: 30_000 });
    } else if (await password.count()) {
      await fillSecret(password.first(), buyer.password);
      await page.locator("#btnLogin").click();
      await settle(password.first());
    } else {
      await pay.first().click();
      await page.waitForURL((url) => url.origin === origin, { timeout: 60_000 });
    }
  }
  await page.waitForURL((url) => url.origin === origin, { timeout: 60_000 });
}
