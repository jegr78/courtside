import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Impact } from "../api/client";
import { formatBookingPeriod } from "../time/clubZone";
import { Button } from "./Button";

// The panel informs; it never gates. Nothing around it is disabled while it loads, because a board
// that has already decided must not be made to wait for a number it did not ask for.
export function ImpactPanel({ kind, subject, timeZone, ask, reportError }: {
  kind: string;
  subject: string;
  timeZone: string;
  ask: () => Promise<Impact>;
  reportError: (failure: unknown) => void;
}) {
  const { t, i18n } = useTranslation();
  const [impact, setImpact] = useState<Impact>();

  async function load() {
    try {
      setImpact(await ask());
    } catch (failure) {
      reportError(failure);
    }
  }

  return <div className="grid gap-2">
    <Button data-testid={`${kind}-impact-${subject}`} className="justify-self-start" type="button" onClick={() => void load()}>
      {t("admin.impact.ask")}
    </Button>
    {impact && <div data-testid={`impact-${subject}`} className="grid gap-1 rounded-lg border p-3 text-sm">
      <p>{t("admin.impact.affected", { affected: impact.affectedCount })}</p>
      {impact.truncated && <p data-testid={`impact-truncated-${subject}`}>
        {t("admin.impact.truncated", { shown: impact.bookings.length })}
      </p>}
      <ul className="grid gap-1">
        {impact.bookings.map((booking) => <li key={booking.bookingId} data-testid={`impact-booking-${booking.bookingId}`}>
          {formatBookingPeriod(booking.startsAt, booking.endsAt, i18n.language, timeZone)}
        </li>)}
      </ul>
    </div>}
  </div>;
}
