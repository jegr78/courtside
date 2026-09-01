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
import { AllowedRoleCheckboxes, Checkbox, ManagingRoleCheckboxes, PlayerCounts } from "./cardControls";
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
  const [confirmed, setConfirmed] = useState<BookingCard>();
  const { error, success, pending, reportError, refuse, save } = useSaving();
  const created = arrivedFromCardCreation(location.state as unknown);
  const disabled = pending.has(MARK);

  useEffect(() => {
    void api.adminBookingCards()
      .then((cards) => {
        const found = cards.find((candidate) => candidate.id === cardId);
        if (!found) {
          refuse(t("admin.facility.cardNotFound"));
          return;
        }
        setCard(found);
        setConfirmed(found);
      })
      .catch(reportError);
  }, [cardId, refuse, reportError, t]);

  function confirm(changed: BookingCard) {
    setCard(changed);
    setConfirmed(changed);
  }

  function saveCard() {
    if (!card) return Promise.resolve();
    return save(MARK, async () => confirm(await api.changeAdminBookingCard(card.id, {
      label: card.label, color: card.color, allowedRoles: card.allowedRoles,
      managingRoles: card.managingRoles, allowedPlayerCounts: card.allowedPlayerCounts,
      countsAgainstLimits: card.countsAgainstLimits, guestAllowed: card.guestAllowed,
      showGenericOccupancy: card.showGenericOccupancy
    })));
  }

  function toggleActive() {
    if (!card) return Promise.resolve();
    return save(MARK, async () => confirm(await api.setAdminBookingCardActive(card.id, !card.active)));
  }

  return <FacilityPage
    testId="admin-booking-card-view"
    title={card?.label ?? t("admin.facility.cards")}
    error={error ?? clubError}
    success={success ?? (created ? t("admin.facility.cardCreated") : undefined)}
  >
    {card !== undefined && club !== undefined && <>
      <Link data-testid="back-to-cards" className="font-semibold underline" to="/admin/facility/booking-cards">
        {t("admin.facility.backToCards")}
      </Link>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <TextField data-testid="card-label" disabled={disabled} label={t("admin.facility.label")} value={card.label} onChange={(event) => setCard({ ...card, label: event.target.value })} />
          <TextField data-testid="card-color" disabled={disabled} type="color" label={t("admin.facility.color")} value={card.color} onChange={(event) => setCard({ ...card, color: event.target.value })} />
          <CardPreview label={card.label} color={card.color} showGenericOccupancy={card.showGenericOccupancy} />
          <PlayerCounts idPrefix="card-counts" disabled={disabled} counts={card.allowedPlayerCounts} changed={(allowedPlayerCounts) => setCard({ ...card, allowedPlayerCounts })} />
        </div>
        <div className="grid content-start gap-4">
          <AllowedRoleCheckboxes disabled={disabled} testIdPrefix="card-allowed-roles" selected={card.allowedRoles} changed={(allowedRoles) => setCard({ ...card, allowedRoles })} />
          <ManagingRoleCheckboxes disabled={disabled} testIdPrefix="card-managing-roles" selected={card.managingRoles} changed={(managingRoles) => setCard({ ...card, managingRoles })} />
          <Checkbox disabled={disabled} data-testid="card-counts-against-limits" label={t("admin.facility.countsAgainstLimits")} checked={card.countsAgainstLimits} changed={(countsAgainstLimits) => setCard({ ...card, countsAgainstLimits })} />
          <Checkbox disabled={disabled} data-testid="card-guest-allowed" label={t("admin.facility.guestAllowed")} checked={card.guestAllowed} changed={(guestAllowed) => setCard({ ...card, guestAllowed })} />
          <Checkbox disabled={disabled} data-testid="card-generic-occupancy" label={t("admin.facility.showGenericOccupancy")} checked={card.showGenericOccupancy} changed={(showGenericOccupancy) => setCard({ ...card, showGenericOccupancy })} />
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
