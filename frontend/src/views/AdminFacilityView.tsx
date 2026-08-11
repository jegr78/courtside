import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  api,
  type AdminCourt,
  type BookingCard,
  type BookingCardRequest,
  type DayOfWeek,
  type OpeningHours,
  type Role
} from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";

const roles: Role[] = ["MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER", "TREASURER"];

export function AdminFacilityView() {
  const { t } = useTranslation();
  const [courts, setCourts] = useState<AdminCourt[]>();
  const [hours, setHours] = useState<OpeningHours[]>();
  const [cards, setCards] = useState<BookingCard[]>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const pendingRef = useRef(new Set<string>());
  const [pending, setPending] = useState(new Set<string>());

  useEffect(() => {
    void Promise.all([api.adminCourts(), api.adminOpeningHours(), api.adminBookingCards()])
      .then(([loadedCourts, loadedHours, loadedCards]) => {
        setCourts(loadedCourts);
        setHours(loadedHours);
        setCards(loadedCards);
      })
      .catch((failure) => setError(problemMessage(failure, t)));
  }, [t]);

  function reportError(failure: unknown) {
    setSuccess(undefined);
    setError(problemMessage(failure, t));
  }

  function reportSuccess() {
    setError(undefined);
    setSuccess(t("admin.facility.saved"));
  }

  function beginMutation(key: string): boolean {
    if (pendingRef.current.has(key)) return false;
    const changed = new Set(pendingRef.current).add(key);
    pendingRef.current = changed;
    setPending(changed);
    return true;
  }

  function endMutation(key: string) {
    const changed = new Set(pendingRef.current);
    changed.delete(key);
    pendingRef.current = changed;
    setPending(changed);
  }

  async function toggleCourt(court: AdminCourt) {
    const key = `court:${court.id}`;
    if (!beginMutation(key)) return;
    try {
      const changed = await api.setAdminCourtActive(court.id, !court.active);
      setCourts((current) => current?.map((item) => item.id === changed.id ? changed : item));
      reportSuccess();
    } catch (failure) {
      reportError(failure);
    } finally {
      endMutation(key);
    }
  }

  async function saveCourt(court: AdminCourt) {
    const key = `court:${court.id}`;
    if (!beginMutation(key)) return;
    try {
      const changed = await api.changeAdminCourt(court.id, { number: court.number, name: court.name ?? undefined });
      setCourts((current) => current?.map((item) => item.id === changed.id ? changed : item));
      reportSuccess();
    } catch (failure) {
      reportError(failure);
    } finally {
      endMutation(key);
    }
  }

  async function createCourt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = "court:new";
    if (!beginMutation(key)) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const created = await api.createAdminCourt({
        number: Number(formString(form, "number")), name: formString(form, "name") || undefined
      });
      setCourts((current) => [...(current ?? []), created]);
      formElement.reset();
      reportSuccess();
    } catch (failure) {
      reportError(failure);
    } finally {
      endMutation(key);
    }
  }

  async function saveHours(day: OpeningHours) {
    if (!day.opensAt || !day.closesAt) return;
    const key = `hours:${day.dayOfWeek}`;
    if (!beginMutation(key)) return;
    try {
      const changed = await api.setAdminOpeningHours(day.dayOfWeek, {
        opensAt: shortTime(day.opensAt), closesAt: shortTime(day.closesAt)
      });
      replaceHours(changed);
      reportSuccess();
    } catch (failure) {
      reportError(failure);
    } finally {
      endMutation(key);
    }
  }

  async function closeDay(day: DayOfWeek) {
    const key = `hours:${day}`;
    if (!beginMutation(key)) return;
    try {
      await api.closeAdminDay(day);
      setHours((current) => current?.map((item) => item.dayOfWeek === day
        ? { dayOfWeek: day, opensAt: null, closesAt: null }
        : item));
      reportSuccess();
    } catch (failure) {
      reportError(failure);
    } finally {
      endMutation(key);
    }
  }

  function replaceHours(changed: OpeningHours) {
    setHours((current) => current?.map((item) => item.dayOfWeek === changed.dayOfWeek ? changed : item));
  }

  async function saveCard(card: BookingCard) {
    const key = `card:${card.id}`;
    if (!beginMutation(key)) return;
    try {
      const changed = await api.changeAdminBookingCard(card.id, cardRequest(card));
      setCards((current) => current?.map((item) => item.id === changed.id ? changed : item));
      reportSuccess();
    } catch (failure) {
      reportError(failure);
    } finally {
      endMutation(key);
    }
  }

  async function toggleCard(card: BookingCard) {
    const key = `card:${card.id}`;
    if (!beginMutation(key)) return;
    try {
      const changed = await api.setAdminBookingCardActive(card.id, !card.active);
      setCards((current) => current?.map((item) => item.id === changed.id ? changed : item));
      reportSuccess();
    } catch (failure) {
      reportError(failure);
    } finally {
      endMutation(key);
    }
  }

  async function createCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = "card:new";
    if (!beginMutation(key)) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const created = await api.createAdminBookingCard({
        label: formString(form, "label"),
        color: formString(form, "color"),
        allowedRoles: form.getAll("allowedRoles") as Role[],
        allowedPlayerCounts: playerCounts(formString(form, "allowedPlayerCounts")),
        countsAgainstLimits: form.get("countsAgainstLimits") === "on",
        guestAllowed: form.get("guestAllowed") === "on",
        showGenericOccupancy: form.get("showGenericOccupancy") === "on"
      });
      setCards((current) => [...(current ?? []), created]);
      formElement.reset();
      reportSuccess();
    } catch (failure) {
      reportError(failure);
    } finally {
      endMutation(key);
    }
  }

  if (error && (!courts || !hours || !cards)) return <Alert>{error}</Alert>;
  if (!courts || !hours || !cards) return <p role="status">{t("status.loading")}</p>;

  return <section data-testid="admin-facility-view" className="surface-panel grid w-full max-w-7xl gap-8 self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-3xl font-bold">{t("admin.facility.title")}</h1>
      <Link to="/" className="font-semibold underline">{t("nav.courts")}</Link>
    </div>
    {error && <Alert>{error}</Alert>}
    {success && <Alert tone="success">{success}</Alert>}
    <section className="grid gap-4">
      <h2 className="text-2xl font-bold">{t("admin.facility.courts")}</h2>
      {courts.map((court) => <CourtEditor key={court.id} court={court} disabled={pending.has(`court:${court.id}`)} changed={(changed) => setCourts((current) => current?.map((item) => item.id === changed.id ? changed : item))} save={saveCourt} toggle={toggleCourt} />)}
      <form noValidate onSubmit={(event) => void createCourt(event)} className="surface-subtle grid gap-3 rounded-xl border p-4 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
        <TextField data-testid="new-court-number" disabled={pending.has("court:new")} name="number" type="number" label={t("admin.facility.number")} />
        <TextField data-testid="new-court-name" disabled={pending.has("court:new")} name="name" label={t("admin.facility.name")} />
        <Button data-testid="create-court" disabled={pending.has("court:new")} type="submit">{t("admin.create")}</Button>
      </form>
    </section>
    <section className="grid gap-4">
      <h2 className="text-2xl font-bold">{t("admin.facility.openingHours")}</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {hours.map((day) => <HoursEditor key={day.dayOfWeek} hours={day} disabled={pending.has(`hours:${day.dayOfWeek}`)} changed={replaceHours} save={saveHours} close={closeDay} />)}
      </div>
    </section>
    <section className="grid gap-4">
      <h2 className="text-2xl font-bold">{t("admin.facility.cards")}</h2>
      {cards.map((card) => <CardEditor key={card.id} card={card} disabled={pending.has(`card:${card.id}`)} changed={(changed) => setCards((current) => current?.map((item) => item.id === changed.id ? changed : item))} save={saveCard} toggle={toggleCard} />)}
      <CardCreateForm disabled={pending.has("card:new")} create={createCard} />
    </section>
  </section>;
}

function CourtEditor({ court, disabled, changed, save, toggle }: { court: AdminCourt; disabled: boolean; changed: (court: AdminCourt) => void; save: (court: AdminCourt) => Promise<void>; toggle: (court: AdminCourt) => Promise<void> }) {
  const { t } = useTranslation();
  return <article className="surface-subtle grid gap-3 rounded-xl border p-4 sm:grid-cols-[8rem_1fr_auto_auto] sm:items-end">
    <TextField disabled={disabled} type="number" label={t("admin.facility.number")} value={court.number} onChange={(event) => changed({ ...court, number: Number(event.target.value) })} />
    <TextField disabled={disabled} data-testid={`court-name-${court.id}`} label={t("admin.facility.name")} value={court.name ?? ""} onChange={(event) => changed({ ...court, name: event.target.value || null })} />
    <Button disabled={disabled} type="button" onClick={() => void save(court)}>{t("admin.save")}</Button>
    <Button disabled={disabled} data-testid={`toggle-court-${court.id}`} type="button" onClick={() => void toggle(court)}>{t(court.active ? "admin.deactivate" : "admin.activate")}</Button>
  </article>;
}

function HoursEditor({ hours, disabled, changed, save, close }: { hours: OpeningHours; disabled: boolean; changed: (hours: OpeningHours) => void; save: (hours: OpeningHours) => Promise<void>; close: (day: DayOfWeek) => Promise<void> }) {
  const { t } = useTranslation();
  return <article className="surface-subtle grid gap-3 rounded-xl border p-4">
    <h3 className="font-bold">{t(`weekday.${hours.dayOfWeek}`)}</h3>
    <div className="grid grid-cols-2 gap-3">
      <TextField disabled={disabled} data-testid={`hours-open-${hours.dayOfWeek}`} type="time" label={t("admin.facility.opensAt")} value={shortTime(hours.opensAt)} onChange={(event) => changed({ ...hours, opensAt: event.target.value })} />
      <TextField disabled={disabled} type="time" label={t("admin.facility.closesAt")} value={shortTime(hours.closesAt)} onChange={(event) => changed({ ...hours, closesAt: event.target.value })} />
    </div>
    <div className="flex gap-3">
      <Button data-testid={`save-hours-${hours.dayOfWeek}`} disabled={disabled || !hours.opensAt || !hours.closesAt} type="button" onClick={() => void save(hours)}>{t("admin.save")}</Button>
      <Button disabled={disabled} type="button" onClick={() => void close(hours.dayOfWeek)}>{t("admin.facility.closeDay")}</Button>
    </div>
  </article>;
}

function CardEditor({ card, disabled, changed, save, toggle }: { card: BookingCard; disabled: boolean; changed: (card: BookingCard) => void; save: (card: BookingCard) => Promise<void>; toggle: (card: BookingCard) => Promise<void> }) {
  const { t } = useTranslation();
  const [counts, setCounts] = useState(card.allowedPlayerCounts.join(", "));
  const countsValue = playerCounts(counts);
  return <article className="surface-subtle grid gap-4 rounded-xl border p-4">
    <div className="grid gap-3 md:grid-cols-3">
      <TextField disabled={disabled} data-testid={`card-label-${card.id}`} label={t("admin.facility.label")} value={card.label} onChange={(event) => changed({ ...card, label: event.target.value })} />
      <TextField disabled={disabled} type="color" label={t("admin.facility.color")} value={card.color} onChange={(event) => changed({ ...card, color: event.target.value })} />
      <RoleCheckboxes disabled={disabled} selected={card.allowedRoles} changed={(allowedRoles) => changed({ ...card, allowedRoles })} />
      <TextField disabled={disabled} data-testid={`card-counts-${card.id}`} label={t("admin.facility.playerCounts")} value={counts} onChange={(event) => setCounts(event.target.value)} />
      <Checkbox disabled={disabled} label={t("admin.facility.countsAgainstLimits")} checked={card.countsAgainstLimits} changed={(countsAgainstLimits) => changed({ ...card, countsAgainstLimits })} />
      <Checkbox disabled={disabled} label={t("admin.facility.guestAllowed")} checked={card.guestAllowed} changed={(guestAllowed) => changed({ ...card, guestAllowed })} />
      <Checkbox disabled={disabled} label={t("admin.facility.showGenericOccupancy")} checked={card.showGenericOccupancy} changed={(showGenericOccupancy) => changed({ ...card, showGenericOccupancy })} />
    </div>
    <div className="flex gap-3">
      <Button disabled={disabled} data-testid={`save-card-${card.id}`} type="button" onClick={() => void save({ ...card, allowedPlayerCounts: countsValue, tracksPlayers: countsValue.length > 0 })}>{t("admin.save")}</Button>
      <Button disabled={disabled} type="button" onClick={() => void toggle(card)}>{t(card.active ? "admin.deactivate" : "admin.activate")}</Button>
    </div>
  </article>;
}

function CardCreateForm({ disabled, create }: { disabled: boolean; create: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  const { t } = useTranslation();
  return <form noValidate onSubmit={(event) => void create(event)} className="surface-subtle grid gap-4 rounded-xl border p-4">
    <h3 className="font-bold">{t("admin.facility.newCard")}</h3>
    <div className="grid gap-3 md:grid-cols-3">
      <TextField disabled={disabled} data-testid="new-card-label" name="label" label={t("admin.facility.label")} />
      <TextField disabled={disabled} name="color" type="color" defaultValue="#b85c38" label={t("admin.facility.color")} />
      <RoleCheckboxes disabled={disabled} name="allowedRoles" selected={[]} testIdPrefix="new-card-role" />
      <TextField disabled={disabled} data-testid="new-card-counts" name="allowedPlayerCounts" label={t("admin.facility.playerCounts")} />
      <Checkbox disabled={disabled} name="countsAgainstLimits" label={t("admin.facility.countsAgainstLimits")} />
      <Checkbox disabled={disabled} name="guestAllowed" label={t("admin.facility.guestAllowed")} />
      <Checkbox disabled={disabled} name="showGenericOccupancy" label={t("admin.facility.showGenericOccupancy")} />
    </div>
    <Button disabled={disabled} data-testid="create-card" className="justify-self-start" type="submit">{t("admin.create")}</Button>
  </form>;
}

function RoleCheckboxes({ name, selected, disabled, changed, testIdPrefix }: { name?: string; selected: Role[]; disabled?: boolean; changed?: (roles: Role[]) => void; testIdPrefix?: string }) {
  const { t } = useTranslation();
  function toggle(role: Role, checked: boolean) {
    changed?.(checked ? [...selected, role] : selected.filter((candidate) => candidate !== role));
  }
  return <fieldset className="grid gap-2">
    <legend className="font-medium">{t("admin.facility.allowedRoles")}</legend>
    <div className="grid gap-2 sm:grid-cols-2">
      {roles.map((role) => <Checkbox key={role} data-testid={testIdPrefix ? `${testIdPrefix}-${role}` : undefined} name={name} disabled={disabled} label={t(`role.${role}`)} checked={selected.includes(role)} value={role} changed={changed ? (checked) => toggle(role, checked) : undefined} />)}
    </div>
    <p data-testid="allowed-roles-hint" className="text-sm text-[var(--cs-muted)]">{t("admin.facility.allowedRolesHint")}</p>
  </fieldset>;
}

function Checkbox({ name, label, checked, disabled, value, changed, ...props }: { name?: string; label: string; checked?: boolean; disabled?: boolean; value?: string; changed?: (checked: boolean) => void; "data-testid"?: string }) {
  return <label className="flex items-center gap-3 font-medium"><input data-testid={props["data-testid"]} name={name} disabled={disabled} type="checkbox" value={value} checked={changed ? checked : undefined} onChange={changed ? (event) => changed(event.target.checked) : undefined} />{label}</label>;
}

function cardRequest(card: BookingCard): BookingCardRequest {
  return {
    label: card.label, color: card.color, allowedRoles: card.allowedRoles,
    allowedPlayerCounts: card.allowedPlayerCounts,
    countsAgainstLimits: card.countsAgainstLimits, guestAllowed: card.guestAllowed,
    showGenericOccupancy: card.showGenericOccupancy
  };
}

function playerCounts(value: string): number[] {
  return value.split(",").map((count) => count.trim()).filter(Boolean).map(Number);
}

function shortTime(value: string | null | undefined): string {
  return value?.slice(0, 5) ?? "";
}

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
