import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, type BookingCard } from "../../api/client";
import { useClubConfiguration } from "../../club/registry";
import { Button } from "../../components/Button";
import { ImpactPanel } from "../../components/ImpactPanel";
import { TextField } from "../../components/TextField";
import { differs } from "../../unsaved/differs";
import { describedByMark } from "../../unsaved/markId";
import { UnsavedMark } from "../../unsaved/UnsavedMark";
import { CardPreview } from "./CardPreview";
import { AllowedRoleCheckboxes, BookingRules, Checkbox, ColorField, ManagingRoleCheckboxes, PlayerCounts } from "./cardControls";
import { FacilityPage } from "./FacilityPage";
import { useSaving } from "./useSaving";

const MARK = "booking-card";

function arrivedFromCardCreation(state: unknown): boolean {
  return typeof state === "object" && state !== null && "cardCreated" in state
    && state.cardCreated === true;
}

export function AdminBookingCardView() {
  const { t } = useTranslation();
  const location = useLocation();
  const { cardId = "" } = useParams();
  const { club, error: clubError } = useClubConfiguration();
  const [card, setCard] = useState<BookingCard>();
  const [missing, setMissing] = useState(false);
  const [confirmed, setConfirmed] = useState<BookingCard>();
  const { error, success, pending, reportError, save } = useSaving();
  const [created, setCreated] = useState(() => arrivedFromCardCreation(location.state as unknown));
  const disabled = pending.has(MARK);

  useEffect(() => {
    void api.adminBookingCards()
      .then((cards) => {
        const found = cards.find((candidate) => candidate.id === cardId);
        setMissing(found === undefined);
        setCard(found);
        setConfirmed(found);
      })
      .catch(reportError);
  }, [cardId, reportError]);

  function confirm(changed: BookingCard) {
    setCreated(false);
    setCard(changed);
    setConfirmed(changed);
  }

  function saveCard() {
    if (!card) return Promise.resolve();
    setCreated(false);
    return save(MARK, async () => confirm(await api.changeAdminBookingCard(card.id, {
      label: card.label, color: card.color, allowedRoles: card.allowedRoles,
      managingRoles: card.managingRoles, allowedPlayerCounts: card.allowedPlayerCounts,
      countsAgainstLimits: card.countsAgainstLimits, guestAllowed: card.guestAllowed,
      showGenericOccupancy: card.showGenericOccupancy
    })));
  }

  // Taking a card out of service is not a save, so it answers for `active` and for nothing else
  // somebody may still be editing on this page.
  function toggleActive() {
    if (!card) return Promise.resolve();
    setCreated(false);
    return save(MARK, async () => {
      const { active } = await api.setAdminBookingCardActive(card.id, !card.active);
      setCreated(false);
      setCard((current) => current && { ...current, active });
      setConfirmed((current) => current && { ...current, active });
    });
  }

  return <FacilityPage
    testId="admin-booking-card-view"
    title={confirmed?.label ?? t("admin.facility.cards")}
    error={error ?? (missing ? t("admin.facility.cardNotFound") : undefined) ?? clubError}
    success={success ?? (created ? t("admin.facility.cardCreated") : undefined)}
  >
    {card !== undefined && club !== undefined && <>
      <Link data-testid="back-to-cards" className="font-semibold underline" to="/admin/facility/booking-cards">
        {t("admin.facility.backToCards")}
      </Link>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <TextField data-testid="card-label" disabled={disabled} label={t("admin.facility.label")} value={card.label} onChange={(event) => setCard({ ...card, label: event.target.value })} />
          <ColorField testId="card-color" disabled={disabled} value={card.color} changed={(color) => setCard({ ...card, color })} />
          <CardPreview label={card.label} color={card.color} showGenericOccupancy={card.showGenericOccupancy} />
          <Checkbox disabled={disabled} data-testid="card-generic-occupancy" label={t("admin.facility.showGenericOccupancy")} checked={card.showGenericOccupancy} changed={(showGenericOccupancy) => setCard({ ...card, showGenericOccupancy })} />
          <PlayerCounts idPrefix="card-counts" disabled={disabled} counts={card.allowedPlayerCounts} changed={(allowedPlayerCounts) => setCard({ ...card, allowedPlayerCounts })} />
        </div>
        <div className="grid content-start gap-4">
          <AllowedRoleCheckboxes disabled={disabled} testIdPrefix="card-allowed-roles" selected={card.allowedRoles} changed={(allowedRoles) => setCard({ ...card, allowedRoles })} />
          <ManagingRoleCheckboxes disabled={disabled} testIdPrefix="card-managing-roles" selected={card.managingRoles} changed={(managingRoles) => setCard({ ...card, managingRoles })} />
          <BookingRules>
            <Checkbox disabled={disabled} data-testid="card-counts-against-limits" label={t("admin.facility.countsAgainstLimits")} checked={card.countsAgainstLimits} changed={(countsAgainstLimits) => setCard({ ...card, countsAgainstLimits })} />
            <Checkbox disabled={disabled} data-testid="card-guest-allowed" label={t("admin.facility.guestAllowed")} checked={card.guestAllowed} changed={(guestAllowed) => setCard({ ...card, guestAllowed })} />
          </BookingRules>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={disabled} data-testid="save-card" aria-describedby={describedByMark(MARK, differs(card, confirmed))} type="button" onClick={() => void saveCard()}>{t("admin.save")}</Button>
        <Button variant={card.active ? "destructive" : "primary"} disabled={disabled} data-testid="toggle-card" type="button" onClick={() => void toggleActive()}>{t(card.active ? "admin.deactivate" : "admin.activate")}</Button>
        <UnsavedMark id={MARK} unsaved={differs(card, confirmed)} />
      </div>
      <ImpactPanel kind="booking-card" subject={card.id} timeZone={club.timeZone} ask={() => api.bookingCardImpact(card.id)} reportError={reportError} />
    </>}
  </FacilityPage>;
}
