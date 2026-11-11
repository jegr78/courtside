import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { api, type BookingCard, type Role } from "../../api/client";
import { refusesField } from "../../api/problem-message";
import { useClubConfiguration } from "../../club/registry";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { formString } from "../../forms/formString";
import { parseMinor } from "../../money";
import { useUnsavedForm } from "../../unsaved/useUnsavedForm";
import { AllowedRoleCheckboxes, BookingRules, CardColorField, Checkbox, DEFAULT_CARD_COLOR, AmountField, ManagingRoleCheckboxes, PlayerCounts } from "./cardControls";
import { FacilityPage } from "./FacilityPage";
import { useSaving } from "./useSaving";

export function AdminBookingCardsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [cards, setCards] = useState<BookingCard[]>();
  const [counts, setCounts] = useState<number[]>([]);
  const { club, error: clubError } = useClubConfiguration();
  const { error, failure, pending, reportError, save } = useSaving();
  const [color, setColor] = useState(DEFAULT_CARD_COLOR);
  const [fee, setFee] = useState("");
  const [price, setPrice] = useState("");
  const [allowedRoles, setAllowedRoles] = useState<Role[]>([]);
  const newCard = useUnsavedForm("card:new", counts.length > 0 || color !== DEFAULT_CARD_COLOR || fee !== ""
    || allowedRoles.length > 0);
  const disabled = pending.has("card:new");
  const guestFeeMinor = fee.trim() && club ? parseMinor(fee, club.currency) : undefined;
  const feeInvalid = fee.trim() !== "" && guestFeeMinor === undefined;
  const pricedForExternals = allowedRoles.includes("EXTERNAL");
  const externalPriceMinor = pricedForExternals && price.trim() && club ? parseMinor(price, club.currency) : undefined;
  const priceInvalid = pricedForExternals && price.trim() !== "" && externalPriceMinor === undefined;

  useEffect(() => {
    void api.adminBookingCards().then(setCards).catch(reportError);
  }, [reportError]);

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (feeInvalid || priceInvalid) return Promise.resolve();
    const form = new FormData(event.currentTarget);
    return save("card:new", async () => {
      const created = await api.createAdminBookingCard({
        label: formString(form, "label"),
        color: formString(form, "color"),
        allowedRoles,
        managingRoles: form.getAll("managingRoles") as Role[],
        allowedPlayerCounts: counts,
        countsAgainstLimits: form.get("countsAgainstLimits") === "on",
        guestAllowed: form.get("guestAllowed") === "on",
        showGenericOccupancy: form.get("showGenericOccupancy") === "on",
        grantsAccess: form.get("grantsAccess") === "on",
        signalsOccupancy: form.get("signalsOccupancy") === "on",
        guestFeeMinor,
        externalPriceMinor
      });
      setCounts([]);
      setColor(DEFAULT_CARD_COLOR);
      setFee("");
      setPrice("");
      setAllowedRoles([]);
      newCard.saved();
      await navigate(`/admin/facility/booking-cards/${created.id}`, { state: { cardCreated: true } });
    });
  }

  return <FacilityPage testId="admin-booking-cards-view" title={t("admin.facility.cards")} error={error ?? clubError}>
    {cards !== undefined && club !== undefined && <>
      <CardCreateForm disabled={disabled} form={newCard.form} counts={counts} setCounts={setCounts} color={color} setColor={setColor}
                      fee={{ value: fee, currency: club.currency, invalid: feeInvalid, refused: refusesField(failure, "guestFeeMinor"), changed: setFee }}
                      roles={{ selected: allowedRoles, changed: setAllowedRoles }}
                      price={pricedForExternals ? { value: price, currency: club.currency, invalid: priceInvalid, refused: refusesField(failure, "externalPriceMinor"), changed: setPrice } : undefined}
                      create={create} />
      <section className="grid gap-3">
        <h2 className="text-2xl font-bold">{t("admin.facility.allCards")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th className="border-b p-2">{t("admin.facility.columnCard")}</th>
                <th className="border-b p-2">{t("admin.facility.columnStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => <tr key={card.id} data-testid={`card-row-${card.id}`}>
                <td className="border-b p-2">
                  <span className="flex items-center gap-3">
                    <span aria-hidden="true" data-testid={`card-swatch-${card.id}`} className="inline-block size-5 shrink-0 rounded-sm border" style={{ backgroundColor: card.color }} />
                    <Link data-testid={`card-link-${card.id}`} className="font-semibold underline" to={`/admin/facility/booking-cards/${card.id}`}>{card.label}</Link>
                  </span>
                </td>
                <td data-testid={`card-status-${card.id}`} className="border-b p-2">{t(card.active ? "admin.facility.statusActive" : "admin.facility.statusInactive")}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </>}
  </FacilityPage>;
}

type AmountDraft = { value: string; currency: string; invalid: boolean; refused: boolean; changed: (value: string) => void };

function CardCreateForm({ disabled, form, counts, setCounts, color, setColor, fee, roles, price, create }: { disabled: boolean; form: ReturnType<typeof useUnsavedForm>["form"]; counts: number[]; setCounts: (counts: number[]) => void; color: string; setColor: (color: string) => void; fee: AmountDraft; roles: { selected: Role[]; changed: (roles: Role[]) => void }; price?: AmountDraft; create: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  const { t } = useTranslation();
  return <form noValidate {...form} onSubmit={(event) => void create(event)} className="grid gap-4 rounded-xl border p-4">
    <h2 className="font-bold">{t("admin.facility.newCard")}</h2>
    <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      <TextField disabled={disabled} data-testid="new-card-label" name="label" label={t("admin.facility.label")} />
      <div className="grid content-start gap-4">
        <CardColorField testId="new-card-color" disabled={disabled} name="color" value={color} changed={setColor} />
        <Checkbox disabled={disabled} name="showGenericOccupancy" label={t("admin.facility.showGenericOccupancy")} />
      </div>
      <PlayerCounts idPrefix="new-card-counts" disabled={disabled} counts={counts} changed={setCounts} />
      <AllowedRoleCheckboxes disabled={disabled} name="allowedRoles" selected={roles.selected} changed={roles.changed} testIdPrefix="new-card-role" />
      <ManagingRoleCheckboxes disabled={disabled} name="managingRoles" selected={[]} testIdPrefix="new-card-managing-roles" />
      <BookingRules>
        <Checkbox disabled={disabled} name="countsAgainstLimits" label={t("admin.facility.countsAgainstLimits")} />
        <Checkbox disabled={disabled} name="guestAllowed" label={t("admin.facility.guestAllowed")} />
        <AmountField kind="guestFee" testId="new-card-guest-fee" disabled={disabled} {...fee} />
        {price && <AmountField kind="externalPrice" testId="new-card-external-price" disabled={disabled} {...price} />}
        <Checkbox disabled={disabled} name="grantsAccess" data-testid="new-card-grants-access" label={t("admin.facility.grantsAccess")} hint={t("admin.facility.grantsAccessHint")} />
        <Checkbox disabled={disabled} name="signalsOccupancy" data-testid="new-card-signals-occupancy" defaultChecked label={t("admin.facility.signalsOccupancy")} hint={t("admin.facility.signalsOccupancyHint")} />
      </BookingRules>
    </div>
    <Button variant="primary" data-testid="create-card" disabled={disabled} className="justify-self-start" type="submit">{t("admin.create")}</Button>
  </form>;
}
