import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type OpenPlace } from "../api/client";
import { useReportedFailure } from "../failures/useReportedFailure";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { LoadFailure } from "../components/LoadFailure";
import { formatBookingPeriod } from "../time/clubZone";

export function OpenPlacesSection({ courtNames, locale, timeZone, taken }: {
  courtNames: Map<string, string>; locale: string; timeZone: string; taken: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [places, setPlaces] = useState<OpenPlace[]>();
  const [taking, setTaking] = useState<string>();
  const { message: error, report, clear } = useReportedFailure();
  const { message: loadError, report: reportLoad, clear: clearLoad } = useReportedFailure();

  const load = useCallback(async () => {
    try {
      setPlaces(await api.openPlaces());
      clearLoad();
    } catch (failure) {
      reportLoad(failure);
    }
  }, [clearLoad, reportLoad]);

  useEffect(() => { void load(); }, [load]);

  async function take(place: OpenPlace) {
    setTaking(place.invitationId);
    try {
      await api.acceptOpenPlace(place.invitationId);
      clear();
      await load();
      await taken();
    } catch (failure) {
      report(failure);
      await load();
    } finally {
      setTaking(undefined);
    }
  }

  if (loadError) return <LoadFailure message={loadError} retry={() => { clearLoad(); void load(); }} />;
  if (!error && (!places || places.length === 0)) return null;

  return <section id="open-places" className="border-structural mt-10 border-t pt-8" aria-labelledby="open-places-title">
    <h2 id="open-places-title" data-testid="open-places-title" className="text-2xl font-bold">{t("openPlaces.title")}</h2>
    <p className="text-muted mt-2">{t("openPlaces.description")}</p>
    {error && <Alert>{error}</Alert>}
    {places && places.length > 0 && <ul data-testid="open-places" className="mt-4 grid gap-3">{places.map((place) => {
      const period = formatBookingPeriod(place.startsAt, place.endsAt, locale, timeZone);
      const courts = place.courtIds.map((id) => courtNames.get(id) ?? t("myBookings.unknownCourt")).join(", ");
      return <li key={place.invitationId} data-testid={`open-place-${place.invitationId}`}
        className="border-structural grid gap-1 rounded-xl border p-4">
        <span data-testid="open-place-title" className="grid font-semibold">
          <span>{period}</span>
          <span>{courts}</span>
        </span>
        <span data-testid="open-place-card" className="text-muted text-sm">{place.cardLabel}</span>
        <div className="pt-1">
          <Button variant="primary" data-testid="take-open-place" data-invitation-id={place.invitationId}
            aria-label={t("openPlaces.takeAccessible", { period, courts })} className="px-3 py-2"
            disabled={taking === place.invitationId} onClick={() => void take(place)}>{t("openPlaces.take")}</Button>
        </div>
      </li>;
    })}</ul>}
  </section>;
}
