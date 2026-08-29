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
  type ParticipantCard,
  type ParticipantCardRequest,
  type Role
} from "../api/client";
import { problemMessage } from "../api/problem-message";
import { shortTime } from "../time/clubZone";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { TextField } from "../components/TextField";
import { formString } from "../forms/formString";
import { useFragmentTarget } from "../navigation/useFragmentTarget";
import { ImpactPanel } from "../components/ImpactPanel";

const roles: Role[] = ["MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER", "TREASURER"];
// The server strips MEMBER before matching a managing role.
const managingRoleOptions: Role[] = roles.filter((role) => role !== "MEMBER");

export function AdminFacilityView() {
  const { t } = useTranslation();
  const [courts, setCourts] = useState<AdminCourt[]>();
  const [hours, setHours] = useState<OpeningHours[]>();
  const [cards, setCards] = useState<BookingCard[]>();
  const [fillers, setFillers] = useState<ParticipantCard[]>();
  const [timeZone, setTimeZone] = useState<string>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const pendingRef = useRef(new Set<string>());
  const [pending, setPending] = useState(new Set<string>());
  useFragmentTarget("opening-hours", courts !== undefined && hours !== undefined
    && cards !== undefined && timeZone !== undefined);

  useEffect(() => {
    void Promise.all([api.adminCourts(), api.adminOpeningHours(), api.adminBookingCards(),
      api.adminParticipantCards(), api.config()])
      .then(([loadedCourts, loadedHours, loadedCards, loadedFillers, configuration]) => {
        setCourts(loadedCourts);
        setHours(loadedHours);
        setCards(loadedCards);
        setFillers(loadedFillers);
        setTimeZone(configuration.timeZone);
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

  async function saveFiller(card: ParticipantCard) {
    const key = `filler:${card.id}`;
    if (!beginMutation(key)) return;
    try {
      const changed = await api.changeParticipantCard(card.id, fillerRequest(card));
      setFillers((current) => current?.map((item) => item.id === changed.id ? changed : item));
      reportSuccess();
    } catch (failure) {
      reportError(failure);
    } finally {
      endMutation(key);
    }
  }

  async function toggleFiller(card: ParticipantCard) {
    const key = `filler:${card.id}`;
    if (!beginMutation(key)) return;
    try {
      const changed = await api.setParticipantCardActive(card.id, !card.active);
      setFillers((current) => current?.map((item) => item.id === changed.id ? changed : item));
      reportSuccess();
    } catch (failure) {
      reportError(failure);
    } finally {
      endMutation(key);
    }
  }

  async function createFiller(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = "filler:new";
    if (!beginMutation(key)) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const created = await api.createParticipantCard({
        label: formString(form, "label"),
        capacity: ownedCount(formString(form, "capacity"))
      });
      setFillers((current) => [...(current ?? []), created]);
      formElement.reset();
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
        managingRoles: form.getAll("managingRoles") as Role[],
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

  return <section data-testid="admin-facility-view" className="surface-panel grid w-full max-w-7xl gap-8 self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-3xl font-bold">{t("admin.facility.title")}</h1>
      <Link to="/" className="font-semibold underline">{t("nav.courts")}</Link>
    </div>
    {!courts || !hours || !cards || !timeZone
      ? (error ? <Alert>{error}</Alert> : <p role="status">{t("status.loading")}</p>)
      : <>
        {error && <Alert>{error}</Alert>}
        {success && <SuccessFeedback>{success}</SuccessFeedback>}
        <section className="grid gap-4">
          <h2 className="text-2xl font-bold">{t("admin.facility.courts")}</h2>
          {courts.map((court) => <CourtEditor key={court.id} court={court} timeZone={timeZone} disabled={pending.has(`court:${court.id}`)} changed={(changed) => setCourts((current) => current?.map((item) => item.id === changed.id ? changed : item))} save={saveCourt} toggle={toggleCourt} reportError={reportError} />)}
          <form noValidate onSubmit={(event) => void createCourt(event)} className="surface-subtle grid gap-3 rounded-xl border p-4 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
            <TextField data-testid="new-court-number" disabled={pending.has("court:new")} name="number" type="number" label={t("admin.facility.number")} />
            <TextField data-testid="new-court-name" disabled={pending.has("court:new")} name="name" label={t("admin.facility.name")} />
            <Button variant="primary" data-testid="create-court" disabled={pending.has("court:new")} type="submit">{t("admin.create")}</Button>
          </form>
        </section>
        <section className="grid gap-4">
          <h2 id="opening-hours" data-testid="opening-hours-heading" tabIndex={-1} className="text-2xl font-bold">{t("admin.facility.openingHours")}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {hours.map((day) => <HoursEditor key={day.dayOfWeek} hours={day} timeZone={timeZone} disabled={pending.has(`hours:${day.dayOfWeek}`)} changed={replaceHours} save={saveHours} close={closeDay} reportError={reportError} />)}
          </div>
        </section>
        <section className="grid gap-4">
          <h2 className="text-2xl font-bold">{t("admin.facility.cards")}</h2>
          {cards.map((card) => <CardEditor key={card.id} card={card} timeZone={timeZone} disabled={pending.has(`card:${card.id}`)} changed={(changed) => setCards((current) => current?.map((item) => item.id === changed.id ? changed : item))} save={saveCard} toggle={toggleCard} reportError={reportError} />)}
          <CardCreateForm disabled={pending.has("card:new")} create={createCard} />
        </section>
        <section className="grid gap-4">
          <h2 className="text-2xl font-bold">{t("admin.facility.participantCards")}</h2>
          <p className="text-sm">{t("admin.facility.participantCardsHint")}</p>
          {(fillers ?? []).map((card) => <ParticipantCardEditor
            key={card.id}
            card={card}
            disabled={pending.has(`filler:${card.id}`)}
            changed={(changed) => setFillers((current) => current?.map((item) => item.id === changed.id ? changed : item))}
            save={saveFiller}
            toggle={toggleFiller}
          />)}
          <ParticipantCardCreateForm disabled={pending.has("filler:new")} create={createFiller} />
        </section>
      </>}
  </section>;
}

function CourtEditor({ court, timeZone, disabled, changed, save, toggle, reportError }: { court: AdminCourt; timeZone: string; disabled: boolean; changed: (court: AdminCourt) => void; save: (court: AdminCourt) => Promise<void>; toggle: (court: AdminCourt) => Promise<void>; reportError: (failure: unknown) => void }) {
  const { t } = useTranslation();
  return <article className="surface-subtle grid gap-3 rounded-xl border p-4 sm:grid-cols-[8rem_1fr_auto_auto] sm:items-end">
    <TextField disabled={disabled} type="number" label={t("admin.facility.number")} value={court.number} onChange={(event) => changed({ ...court, number: Number(event.target.value) })} />
    <TextField disabled={disabled} data-testid={`court-name-${court.id}`} label={t("admin.facility.name")} value={court.name ?? ""} onChange={(event) => changed({ ...court, name: event.target.value || null })} />
    <Button variant="primary" disabled={disabled} type="button" onClick={() => void save(court)}>{t("admin.save")}</Button>
    <Button variant={court.active ? "destructive" : "primary"} disabled={disabled} data-testid={`toggle-court-${court.id}`} type="button" onClick={() => void toggle(court)}>{t(court.active ? "admin.deactivate" : "admin.activate")}</Button>
    <div className="sm:col-span-full">
      <ImpactPanel kind="court" subject={court.id} timeZone={timeZone} ask={() => api.courtImpact(court.id)} reportError={reportError} />
    </div>
  </article>;
}

function HoursEditor({ hours, timeZone, disabled, changed, save, close, reportError }: { hours: OpeningHours; timeZone: string; disabled: boolean; changed: (hours: OpeningHours) => void; save: (hours: OpeningHours) => Promise<void>; close: (day: DayOfWeek) => Promise<void>; reportError: (failure: unknown) => void }) {
  const { t } = useTranslation();
  return <article className="surface-subtle grid gap-3 rounded-xl border p-4">
    <h3 className="font-bold">{t(`weekday.${hours.dayOfWeek}`)}</h3>
    <div className="grid grid-cols-2 gap-3">
      <TextField disabled={disabled} data-testid={`hours-open-${hours.dayOfWeek}`} type="time" label={t("admin.facility.opensAt")} value={shortTime(hours.opensAt)} onChange={(event) => changed({ ...hours, opensAt: event.target.value })} />
      <TextField disabled={disabled} type="time" label={t("admin.facility.closesAt")} value={shortTime(hours.closesAt)} onChange={(event) => changed({ ...hours, closesAt: event.target.value })} />
    </div>
    <div className="flex gap-3">
      <Button variant="primary" data-testid={`save-hours-${hours.dayOfWeek}`} disabled={disabled || !hours.opensAt || !hours.closesAt} type="button" onClick={() => void save(hours)}>{t("admin.save")}</Button>
      <Button variant="destructive" disabled={disabled} type="button" onClick={() => void close(hours.dayOfWeek)}>{t("admin.facility.closeDay")}</Button>
    </div>
    <ImpactPanel
      kind="opening-hours"
      subject={hours.dayOfWeek}
      timeZone={timeZone}
      ask={() => api.openingHoursImpact(hours.dayOfWeek, shortTime(hours.opensAt), shortTime(hours.closesAt))}
      reportError={reportError}
    />
  </article>;
}

function CardEditor({ card, timeZone, disabled, changed, save, toggle, reportError }: { card: BookingCard; timeZone: string; disabled: boolean; changed: (card: BookingCard) => void; save: (card: BookingCard) => Promise<void>; toggle: (card: BookingCard) => Promise<void>; reportError: (failure: unknown) => void }) {
  const { t } = useTranslation();
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
    <div className="flex gap-3">
      <Button variant="primary" disabled={disabled} data-testid={`save-card-${card.id}`} type="button" onClick={() => void save({ ...card, allowedPlayerCounts: countsValue, tracksPlayers: countsValue.length > 0 })}>{t("admin.save")}</Button>
      <Button variant={card.active ? "destructive" : "primary"} disabled={disabled} type="button" onClick={() => void toggle(card)}>{t(card.active ? "admin.deactivate" : "admin.activate")}</Button>
    </div>
    <ImpactPanel kind="booking-card" subject={card.id} timeZone={timeZone} ask={() => api.bookingCardImpact(card.id)} reportError={reportError} />
  </article>;
}

function ParticipantCardEditor({ card, disabled, changed, save, toggle }: { card: ParticipantCard; disabled: boolean; changed: (card: ParticipantCard) => void; save: (card: ParticipantCard) => Promise<void>; toggle: (card: ParticipantCard) => Promise<void> }) {
  const { t } = useTranslation();
  return <article className="surface-subtle grid gap-4 rounded-xl border p-4">
    <div className="grid gap-3 md:grid-cols-2">
      <TextField disabled={disabled} data-testid={`participant-card-label-${card.id}`} label={t("admin.facility.label")} value={card.label} onChange={(event) => changed({ ...card, label: event.target.value })} />
      <TextField disabled={disabled} data-testid={`participant-card-capacity-${card.id}`} type="number" min={1} max={99} label={t("admin.facility.owned")} value={card.capacity ?? ""} onChange={(event) => changed({ ...card, capacity: ownedCount(event.target.value) })} />
    </div>
    <div className="flex gap-3">
      <Button variant="primary" disabled={disabled} data-testid={`save-participant-card-${card.id}`} type="button" onClick={() => void save(card)}>{t("admin.save")}</Button>
      <Button variant={card.active ? "destructive" : "primary"} disabled={disabled} data-testid={`toggle-participant-card-${card.id}`} type="button" onClick={() => void toggle(card)}>{t(card.active ? "admin.deactivate" : "admin.activate")}</Button>
    </div>
  </article>;
}

function ParticipantCardCreateForm({ disabled, create }: { disabled: boolean; create: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  const { t } = useTranslation();
  return <form noValidate onSubmit={(event) => void create(event)} className="surface-subtle grid gap-4 rounded-xl border p-4">
    <h3 className="font-bold">{t("admin.facility.newParticipantCard")}</h3>
    <div className="grid gap-3 md:grid-cols-2">
      <TextField disabled={disabled} data-testid="new-participant-card-label" name="label" label={t("admin.facility.label")} />
      <TextField disabled={disabled} data-testid="new-participant-card-capacity" name="capacity" type="number" min={1} max={99} label={t("admin.facility.owned")} />
    </div>
    <Button variant="primary" disabled={disabled} data-testid="create-participant-card" className="justify-self-start" type="submit">{t("admin.create")}</Button>
  </form>;
}

// An empty field is how a board says "any number of them", which the contract spells as absent.
function ownedCount(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

function fillerRequest(card: ParticipantCard): ParticipantCardRequest {
  return { label: card.label, capacity: card.capacity ?? null };
}

function CardCreateForm({ disabled, create }: { disabled: boolean; create: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  const { t } = useTranslation();
  return <form noValidate onSubmit={(event) => void create(event)} className="surface-subtle grid gap-4 rounded-xl border p-4">
    <h3 className="font-bold">{t("admin.facility.newCard")}</h3>
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
