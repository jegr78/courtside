import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { api, type BookingCard, type Role } from "../../api/client";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { formString } from "../../forms/formString";
import { useUnsavedForm } from "../../unsaved/useUnsavedForm";
import { AllowedRoleCheckboxes, BookingRules, Checkbox, ColorField, ManagingRoleCheckboxes, PlayerCounts } from "./cardControls";
import { FacilityPage } from "./FacilityPage";
import { useSaving } from "./useSaving";

export function AdminBookingCardsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [cards, setCards] = useState<BookingCard[]>();
  const [counts, setCounts] = useState<number[]>([]);
  const { error, pending, reportError, save } = useSaving();
  const newCard = useUnsavedForm("card:new", counts.length > 0);
  const disabled = pending.has("card:new");

  useEffect(() => {
    void api.adminBookingCards().then(setCards).catch(reportError);
  }, [reportError]);

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return save("card:new", async () => {
      const created = await api.createAdminBookingCard({
        label: formString(form, "label"),
        color: formString(form, "color"),
        allowedRoles: form.getAll("allowedRoles") as Role[],
        managingRoles: form.getAll("managingRoles") as Role[],
        allowedPlayerCounts: counts,
        countsAgainstLimits: form.get("countsAgainstLimits") === "on",
        guestAllowed: form.get("guestAllowed") === "on",
        showGenericOccupancy: form.get("showGenericOccupancy") === "on"
      });
      setCounts([]);
      newCard.saved();
      await navigate(`/admin/facility/booking-cards/${created.id}`, { state: { cardCreated: true } });
    });
  }

  return <FacilityPage testId="admin-booking-cards-view" title={t("admin.facility.cards")} error={error}>
    {cards !== undefined && <>
      <CardCreateForm disabled={disabled} form={newCard.form} counts={counts} setCounts={setCounts} create={create} />
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

function CardCreateForm({ disabled, form, counts, setCounts, create }: { disabled: boolean; form: ReturnType<typeof useUnsavedForm>["form"]; counts: number[]; setCounts: (counts: number[]) => void; create: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  const { t } = useTranslation();
  return <form noValidate {...form} onSubmit={(event) => void create(event)} className="surface-subtle grid gap-4 rounded-xl border p-4">
    <h2 className="font-bold">{t("admin.facility.newCard")}</h2>
    <div className="grid items-start gap-4 md:grid-cols-3">
      <TextField disabled={disabled} data-testid="new-card-label" name="label" label={t("admin.facility.label")} />
      <div className="grid content-start gap-4">
        <ColorField disabled={disabled} name="color" />
        <Checkbox disabled={disabled} name="showGenericOccupancy" label={t("admin.facility.showGenericOccupancy")} />
      </div>
      <PlayerCounts idPrefix="new-card-counts" disabled={disabled} counts={counts} changed={setCounts} />
      <AllowedRoleCheckboxes disabled={disabled} name="allowedRoles" selected={[]} testIdPrefix="new-card-role" />
      <ManagingRoleCheckboxes disabled={disabled} name="managingRoles" selected={[]} testIdPrefix="new-card-managing-roles" />
      <BookingRules>
        <Checkbox disabled={disabled} name="countsAgainstLimits" label={t("admin.facility.countsAgainstLimits")} />
        <Checkbox disabled={disabled} name="guestAllowed" label={t("admin.facility.guestAllowed")} />
      </BookingRules>
    </div>
    <Button variant="primary" data-testid="create-card" disabled={disabled} className="justify-self-start" type="submit">{t("admin.create")}</Button>
  </form>;
}
