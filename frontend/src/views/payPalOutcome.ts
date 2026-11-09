import type { PayPalCaptureOutcome } from "../api/client";
import type { AlertTone } from "../components/noticeTones";

export type PayPalPaymentMode = "return" | "cancel";

export function payPalOutcomeKey(mode: PayPalPaymentMode, outcome: PayPalCaptureOutcome): string {
  return `paypalPayment.${mode}.${outcome}`;
}

export function payPalOutcomeTone(mode: PayPalPaymentMode, outcome: PayPalCaptureOutcome): AlertTone {
  if (outcome === "CONFIRMED") return "success";
  return mode === "cancel" && outcome === "REJECTED" ? "info" : "warning";
}
