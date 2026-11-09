import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { api, type PayPalCapture } from "../api/client";
import { isUnauthenticated, problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { payPalOutcomeKey, payPalOutcomeTone, type PayPalPaymentMode } from "./payPalOutcome";

export function PayPalPaymentView({ mode }: { mode: PayPalPaymentMode }) {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const orderId = search.get("token")?.trim() ?? "";
  const [settled, setSettled] = useState<PayPalCapture>();
  const [failure, setFailure] = useState<string>();
  const sent = useRef<string>(undefined);

  useEffect(() => {
    if (sent.current === `${mode}:${orderId}`) return;
    sent.current = `${mode}:${orderId}`;
    if (!orderId) {
      setFailure(t("paypalPayment.missingOrder"));
      return;
    }
    void (mode === "return" ? api.capturePayPalOrder(orderId) : api.cancelPayPalOrder(orderId))
      .then(setSettled)
      .catch((refusal: unknown) => {
        // The shell answers a lost session with sign-in and brings the player back to this address.
        if (!isUnauthenticated(refusal)) setFailure(problemMessage(refusal, t));
      });
  }, [mode, orderId, t]);

  const confirmed = settled?.outcome === "CONFIRMED";
  return <section data-testid="paypal-payment-view" aria-labelledby="paypal-payment-title"
    className="surface-panel w-full max-w-md rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 id="paypal-payment-title" className="text-2xl font-bold">{t(`paypalPayment.${mode}.title`)}</h1>
    <div className="mt-4 grid gap-4">
      {!settled && !failure && <p data-testid="paypal-processing" role="status">{t(`paypalPayment.${mode}.processing`)}</p>}
      {settled && <div data-testid="paypal-outcome" data-outcome={settled.outcome}>
        <Alert tone={payPalOutcomeTone(mode, settled.outcome)}>{t(payPalOutcomeKey(mode, settled.outcome))}</Alert>
      </div>}
      {failure && <div data-testid="paypal-failure"><Alert>{failure}</Alert></div>}
      {(settled || failure) && <p>
        <Link data-testid="paypal-to-bookings" to={confirmed ? `/my-bookings#booking-${settled.bookingId}` : "/my-bookings"}
          className="font-semibold underline underline-offset-4">
          {t(confirmed ? "paypalPayment.toBooking" : "paypalPayment.toMyBookings")}
        </Link>
      </p>}
    </div>
  </section>;
}
