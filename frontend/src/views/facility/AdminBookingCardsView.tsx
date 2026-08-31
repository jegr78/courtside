import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type BookingCard, type BookingCardRequest, type Role } from "../../api/client";
import { useClubConfiguration } from "../../club/registry";
import { Button } from "../../components/Button";
import { ImpactPanel } from "../../components/ImpactPanel";
import { TextField } from "../../components/TextField";
import { formString } from "../../forms/formString";
import { differs } from "../../unsaved/differs";
import { describedByMark } from "../../unsaved/markId";
import { UnsavedMark } from "../../unsaved/UnsavedMark";
import { useUnsavedForm } from "../../unsaved/useUnsavedForm";
import { FacilityPage } from "./FacilityPage";
import { useSaving } from "./useSaving";

const roles: Role[] = ["MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER", "TREASURER"];
// The server strips MEMBER before matching a managing role.
const managingRoleOptions: Role[] = roles.filter((role) => role !== "MEMBER");

export function AdminBookingCardsView() {
  const { t } = useTranslation();
  const { club, error: clubError } = useClubConfiguration();
  const [cards, setCards] = useState<BookingCard[]>();
  const [confirmed, setConfirmed] = useState<Record<string, BookingCard>>({});
  const { error, success, pending, reportError, save } = useSaving();

  useEffect(() => {
    void api.adminBookingCards()
      .then((loaded) => {
        setCards(loaded);
        setConfirmed(Object.fromEntries(loaded.map((card) => [card.id, card])));
      })
      .catch(reportError);
  }, [reportError]);

  function confirm(changed: BookingCard) {
    setCards((current) => current?.some((item) => item.id === changed.id)
      ? current.map((item) => item.id === changed.id ? changed : item)
      : [...(current ?? []), changed]);
    setConfirmed((current) => ({ ...current, [changed.id]: changed }));
  }

  function applyEdit(changed: BookingCard) {
    setCards((current) => current?.map((item) => item.id === changed.id ? changed : item));
  }

  function saveCard(card: BookingCard) {
    return save(`card:${card.id}`, async () =>
      confirm(await api.changeAdminBookingCard(card.id, cardRequest(card))));
  }

  function toggle(card: BookingCard) {
    return save(`card:${card.id}`, async () =>
      confirm(await api.setAdminBookingCardActive(card.id, !card.active)));
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    return save("card:new", async () => {
      confirm(await api.createAdminBookingCard({
        label: formString(form, "label"),
        color: formString(form, "color"),
        allowedRoles: form.getAll("allowedRoles") as Role[],
        managingRoles: form.getAll("managingRoles") as Role[],
        allowedPlayerCounts: playerCounts(formString(form, "allowedPlayerCounts")),
        countsAgainstLimits: form.get("countsAgainstLimits") === "on",
        guestAllowed: form.get("guestAllowed") === "on",
        showGenericOccupancy: form.get("showGenericOccupancy") === "on"
      }));
      formElement.reset();
    });
  }

  return <FacilityPage testId="admin-booking-cards-view" title={t("admin.facility.cards")} error={error ?? clubError} success={success}>
    {cards !== undefined && club !== undefined && <>
      <CardCreateForm disabled={pending.has("card:new")} create={create} />
      {cards.map((card) => <CardEditor
        key={card.id}
        card={card}
        confirmed={confirmed[card.id]}
        timeZone={club.timeZone}
        disabled={pending.has(`card:${card.id}`)}
        changed={applyEdit}
        save={saveCard}
        toggle={toggle}
        reportError={reportError}
      />)}
    </>}
  </FacilityPage>;
}

function CardEditor({ card, confirmed, timeZone, disabled, changed, save, toggle, reportError }: { card: BookingCard; confirmed?: BookingCard; timeZone: string; disabled: boolean; changed: (card: BookingCard) => void; save: (card: BookingCard) => Promise<void>; toggle: (card: BookingCard) => Promise<void>; reportError: (failure: unknown) => void }) {
  const { t } = useTranslation();
  const mark = `card:${card.id}`;
  const unsaved = differs(card, confirmed);
  const [counts, setCounts] = useState(card.allowedPlayerCounts.join(", "));
  const countsValue = playerCounts(counts);
  return <article className="surface-subtle grid gap-4 rounded-xl border p-4">
    <div className="grid gap-3 md:grid-cols-3">
      <TextField disabled={disabled} data-testid={`card-label-${card.id}`} label={t("admin.facility.label")} value={card.label} onChange={(event) => changed({ ...card, label: event.target.value })} />
      <TextField disabled={disabled} type="color" label={t("admin.facility.color")} value={card.color} onChange={(event) => changed({ ...card, color: event.target.value })} />
      <AllowedRoleCheckboxes disabled={disabled} testIdPrefix={`card-allowed-roles-${card.id}`} selected={card.allowedRoles} changed={(allowedRoles) => changed({ ...card, allowedRoles })} />
      <ManagingRoleCheckboxes disabled={disabled} testIdPrefix={`card-managing-roles-${card.id}`} selected={card.managingRoles} changed={(managingRoles) => changed({ ...card, managingRoles })} />
      <TextField disabled={disabled} data-testid={`card-counts-${card.id}`} label={t("admin.facility.playerCounts")} value={counts} onChange={(event) => setCounts(event.target.value)} />
      <Checkbox disabled={disabled} label={t("admin.facility.countsAgainstLimits")} checked={card.countsAgainstLimits} changed={(countsAgainstLimits) => changed({ ...card, countsAgainstLimits })} />
      <Checkbox disabled={disabled} label={t("admin.facility.guestAllowed")} checked={card.guestAllowed} changed={(guestAllowed) => changed({ ...card, guestAllowed })} />
      <Checkbox disabled={disabled} data-testid={`card-generic-occupancy-${card.id}`} label={t("admin.facility.showGenericOccupancy")} checked={card.showGenericOccupancy} changed={(showGenericOccupancy) => changed({ ...card, showGenericOccupancy })} />
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" disabled={disabled} data-testid={`save-card-${card.id}`} aria-describedby={describedByMark(mark, unsaved)} type="button" onClick={() => void save({ ...card, allowedPlayerCounts: countsValue, tracksPlayers: countsValue.length > 0 })}>{t("admin.save")}</Button>
      <Button variant={card.active ? "destructive" : "primary"} disabled={disabled} type="button" onClick={() => void toggle(card)}>{t(card.active ? "admin.deactivate" : "admin.activate")}</Button>
      <UnsavedMark id={mark} unsaved={unsaved} />
    </div>
    <ImpactPanel kind="booking-card" subject={card.id} timeZone={timeZone} ask={() => api.bookingCardImpact(card.id)} reportError={reportError} />
  </article>;
}

function CardCreateForm({ disabled, create }: { disabled: boolean; create: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  const { t } = useTranslation();
  const { form } = useUnsavedForm("card:new");
  return <form noValidate {...form} onSubmit={(event) => void create(event)} className="surface-subtle grid gap-4 rounded-xl border p-4">
    <h2 className="font-bold">{t("admin.facility.newCard")}</h2>
    <div className="grid gap-3 md:grid-cols-3">
      <TextField disabled={disabled} data-testid="new-card-label" name="label" label={t("admin.facility.label")} />
      <TextField disabled={disabled} name="color" type="color" defaultValue="#b85c38" label={t("admin.facility.color")} />
      <AllowedRoleCheckboxes disabled={disabled} name="allowedRoles" selected={[]} testIdPrefix="new-card-role" />
      <ManagingRoleCheckboxes disabled={disabled} name="managingRoles" selected={[]} testIdPrefix="new-card-managing-roles" />
      <TextField disabled={disabled} data-testid="new-card-counts" name="allowedPlayerCounts" label={t("admin.facility.playerCounts")} />
      <Checkbox disabled={disabled} name="countsAgainstLimits" label={t("admin.facility.countsAgainstLimits")} />
      <Checkbox disabled={disabled} name="guestAllowed" label={t("admin.facility.guestAllowed")} />
      <Checkbox disabled={disabled} name="showGenericOccupancy" label={t("admin.facility.showGenericOccupancy")} />
    </div>
    <Button variant="primary" disabled={disabled} data-testid="create-card" className="justify-self-start" type="submit">{t("admin.create")}</Button>
  </form>;
}

function RoleCheckboxes({ options, legendKey, hintKey, hintTestId, name, selected, disabled, changed, testIdPrefix }: { options: Role[]; legendKey: string; hintKey: string; hintTestId: string; name?: string; selected: Role[]; disabled?: boolean; changed?: (roles: Role[]) => void; testIdPrefix?: string }) {
  const { t } = useTranslation();
  function toggle(role: Role, checked: boolean) {
    changed?.(checked ? [...selected, role] : selected.filter((candidate) => candidate !== role));
  }
  return <fieldset className="grid gap-2">
    <legend className="font-medium">{t(legendKey)}</legend>
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((role) => <Checkbox key={role} data-testid={testIdPrefix ? `${testIdPrefix}-${role}` : undefined} name={name} disabled={disabled} label={t(`role.${role}`)} checked={selected.includes(role)} value={role} changed={changed ? (checked) => toggle(role, checked) : undefined} />)}
    </div>
    <p data-testid={hintTestId} className="text-sm text-[var(--cs-muted)]">{t(hintKey)}</p>
  </fieldset>;
}

function AllowedRoleCheckboxes(props: { name?: string; selected: Role[]; disabled?: boolean; changed?: (roles: Role[]) => void; testIdPrefix?: string }) {
  return <RoleCheckboxes {...props} options={roles} legendKey="admin.facility.allowedRoles" hintKey="admin.facility.allowedRolesHint" hintTestId="allowed-roles-hint" />;
}

function ManagingRoleCheckboxes(props: { name?: string; selected: Role[]; disabled?: boolean; changed?: (roles: Role[]) => void; testIdPrefix?: string }) {
  return <RoleCheckboxes {...props} options={managingRoleOptions} legendKey="admin.facility.managingRoles" hintKey="admin.facility.managingRolesHint" hintTestId="managing-roles-hint" />;
}

function Checkbox({ name, label, checked, disabled, value, changed, ...props }: { name?: string; label: string; checked?: boolean; disabled?: boolean; value?: string; changed?: (checked: boolean) => void; "data-testid"?: string }) {
  return <label className="flex items-center gap-3 font-medium"><input data-testid={props["data-testid"]} name={name} disabled={disabled} type="checkbox" value={value} checked={changed ? checked : undefined} onChange={changed ? (event) => changed(event.target.checked) : undefined} />{label}</label>;
}

function cardRequest(card: BookingCard): BookingCardRequest {
  return {
    label: card.label, color: card.color, allowedRoles: card.allowedRoles,
    managingRoles: card.managingRoles, allowedPlayerCounts: card.allowedPlayerCounts,
    countsAgainstLimits: card.countsAgainstLimits, guestAllowed: card.guestAllowed,
    showGenericOccupancy: card.showGenericOccupancy
  };
}

function playerCounts(value: string): number[] {
  return value.split(",").map((count) => count.trim()).filter(Boolean).map(Number);
}
