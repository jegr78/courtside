import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, ApiError, type Dependant, type GuardianGrant, type Notification, type PersonalBooking, type PublicCourt } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { useClubConfiguration } from "../club/registry";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { LoadFailure } from "../components/LoadFailure";
import { Modal } from "../components/Modal";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { TextField } from "../components/TextField";
import { useReportedFailure } from "../failures/useReportedFailure";
import { announceDependantsChanged } from "../navigation/dependants";
import { formatCalendarDate } from "../time/clubZone";
import { CancelDialog } from "./AppointmentDialogs";
import { BookingSection } from "./MyBookingsView";
import { NotificationEntry } from "./MyMessagesView";

const GRANT_ORDER: GuardianGrant[] = ["VIEW_BOOKINGS", "BOOK", "CANCEL_BOOKINGS", "READ_MESSAGES", "ACCOUNT_TASKS"];
const RECENT_AUTH = "urn:courtside:error:recent-authentication-required";
const RELATIONSHIP_CHANGED = new Set(["urn:courtside:error:dependant-not-found", "urn:courtside:error:guardian-action-not-granted"]);

const nameOf = (dependant: Dependant) => `${dependant.firstName} ${dependant.lastName}`;

function relationshipChanged(failure: unknown): boolean {
  return failure instanceof ApiError && RELATIONSHIP_CHANGED.has(failure.problem?.type ?? "");
}

export function DependantsView() {
  const { t } = useTranslation();
  const [dependants, setDependants] = useState<Dependant[]>();
  const [chosen, setChosen] = useState<string>();
  const [refusal, setRefusal] = useState<{ cause: unknown }>();
  const { message: loadError, report: reportLoad, clear: clearLoad } = useReportedFailure();

  const load = useCallback(async () => {
    try {
      const read = await api.dependants();
      setDependants(read);
      setChosen((current) => read.some((dependant) => dependant.personId === current) ? current : read[0]?.personId);
      clearLoad();
    } catch (failure) {
      reportLoad(failure);
    }
  }, [clearLoad, reportLoad]);

  useEffect(() => { void load(); }, [load]);

  // A refusal that says the relationship no longer covers the action is answered with what holds now.
  const refused = useCallback(async (cause: unknown) => {
    setRefusal({ cause });
    announceDependantsChanged();
    await load();
  }, [load]);

  const dependant = dependants?.find((candidate) => candidate.personId === chosen);
  return <section data-testid="dependants-view" className="surface-panel grid w-full max-w-5xl gap-6 self-start rounded-2xl border p-4 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-3xl font-bold">{t("dependants.title")}</h1>
    {loadError && <LoadFailure message={loadError} retry={() => { clearLoad(); void load(); }} />}
    {refusal && <Alert testId="dependants-refusal">{problemMessage(refusal.cause, t)}</Alert>}
    {dependants && (dependants.length === 0
      ? <p data-testid="dependants-none" className="text-muted">{t("dependants.none")}</p>
      : <>
        {dependants.length > 1 && <label className="grid max-w-md gap-2 font-medium">
          {t("dependants.choose")}
          <select data-testid="dependant-choice" className="form-control w-full min-w-0 rounded-lg border px-3 py-3" value={chosen}
                  onChange={(event) => { setRefusal(undefined); setChosen(event.target.value); }}>
            {dependants.map((candidate) => <option key={candidate.personId} value={candidate.personId}>{nameOf(candidate)}</option>)}
          </select>
        </label>}
        {dependant && <DependantPanel key={dependant.personId} dependant={dependant} refused={refused} acted={() => setRefusal(undefined)} />}
      </>)}
  </section>;
}

function DependantPanel({ dependant, refused, acted }: { dependant: Dependant; refused: (cause: unknown) => Promise<void>; acted: () => void }) {
  const { t, i18n } = useTranslation();
  const name = nameOf(dependant);
  const [messageRevision, setMessageRevision] = useState(0);
  const grants = GRANT_ORDER.filter((grant) => dependant.grants.includes(grant));
  const may = (grant: GuardianGrant) => dependant.grants.includes(grant);
  return <article data-testid={`dependant-${dependant.personId}`} aria-labelledby="dependant-name" className="grid gap-6">
    <div className="grid gap-1">
      <h2 id="dependant-name" data-testid="dependant-name" className="text-2xl font-bold">{name}</h2>
      <p data-testid="dependant-grants" className="text-muted">
        {t("dependants.grants", { grants: grants.map((grant) => t(`guardianGrant.${grant}`)).join(", ") })}
      </p>
      {dependant.endedOn && <p data-testid="dependant-ends-on" className="text-muted">{t("dependants.endsOn", { endedOn: formatCalendarDate(dependant.endedOn, i18n.resolvedLanguage ?? "de") })}</p>}
    </div>
    {may("BOOK") && <section data-testid="dependant-book" aria-labelledby="dependant-book-title" className="grid gap-2">
      <h3 id="dependant-book-title" className="text-xl font-semibold">{t("dependants.book", { name })}</h3>
      <p>{t("dependants.bookHint", { name })}</p>
      <Link to="/" data-testid="dependant-to-courts" className="focus-ring inline-flex min-h-11 items-center justify-self-start font-semibold underline underline-offset-4">
        {t("dependants.toCourts")}
      </Link>
    </section>}
    {may("VIEW_BOOKINGS") && <DependantBookings dependant={dependant} cancels={may("CANCEL_BOOKINGS")} refused={refused} acted={() => { acted(); setMessageRevision((revision) => revision + 1); }} />}
    {may("READ_MESSAGES") && <DependantMessages dependant={dependant} refused={refused} revision={messageRevision} />}
    {may("ACCOUNT_TASKS") && <DependantCredentials dependant={dependant} refused={refused} acted={acted} />}
  </article>;
}

function DependantBookings({ dependant, cancels, refused, acted }: {
  dependant: Dependant; cancels: boolean; refused: (cause: unknown) => Promise<void>; acted: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { club } = useClubConfiguration();
  const name = nameOf(dependant);
  const [bookings, setBookings] = useState<PersonalBooking[]>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [courts, setCourts] = useState<PublicCourt[]>([]);
  const [cancelling, setCancelling] = useState<PersonalBooking>();
  const [success, setSuccess] = useState<string>();
  const { message: error, report, clear } = useReportedFailure();

  const load = useCallback(async () => {
    try {
      const [page, available] = await Promise.all([api.dependantBookings(dependant.personId), api.courts()]);
      setBookings(page.items);
      setNextCursor(page.nextCursor ?? undefined);
      setCourts(available);
      clear();
    } catch (failure) {
      if (relationshipChanged(failure)) await refused(failure);
      else report(failure);
    }
  }, [dependant.personId, clear, report, refused]);

  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    try {
      const page = await api.dependantBookings(dependant.personId, { cursor: nextCursor });
      setBookings((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor ?? undefined);
    } catch (failure) {
      if (relationshipChanged(failure)) await refused(failure);
      else report(failure);
    }
  }

  const courtNames = new Map(courts.map((court) => [court.id, court.name ?? t("court.number", { number: court.number })]));
  return <section data-testid="dependant-bookings" aria-labelledby="dependant-bookings-title" className="grid gap-3">
    <h3 id="dependant-bookings-title" className="text-xl font-semibold">{t("dependants.bookings")}</h3>
    {error && <Alert>{error}</Alert>}
    {success && <SuccessFeedback testId="dependant-cancelled">{success}</SuccessFeedback>}
    {bookings && club && <BookingSection testId="dependant-booking-list" empty={t("dependants.noBookings", { name })} bookings={bookings}
      courtNames={courtNames} locale={i18n.language} timeZone={club.timeZone} actionable={cancels} movable={false}
      action={({ booking }) => { setSuccess(undefined); setCancelling(booking); }} t={t} />}
    {nextCursor && <Button variant="secondary" data-testid="dependant-load-more-bookings" className="justify-self-start"
      onClick={() => void loadMore()}>{t("dependants.loadMoreBookings")}</Button>}
    {cancelling && club && <CancelDialog booking={cancelling} seriesBookings={[]} incompleteSeries={false} timeZone={club.timeZone}
      closed={() => setCancelling(undefined)}
      cancelOne={async () => {
        try {
          await api.cancelDependantBooking(dependant.personId, cancelling.id);
        } catch (failure) {
          if (relationshipChanged(failure)) void refused(failure);
          throw failure;
        }
        acted();
        setSuccess(t("dependants.cancelled", { name }));
      }}
      completed={async () => { setCancelling(undefined); await load(); }} />}
  </section>;
}

function DependantMessages({ dependant, refused, revision }: { dependant: Dependant; refused: (cause: unknown) => Promise<void>; revision: number }) {
  const { t, i18n } = useTranslation();
  const { club } = useClubConfiguration();
  const name = nameOf(dependant);
  const [entries, setEntries] = useState<Notification[]>();
  const [nextCursor, setNextCursor] = useState<string>();
  const { message: error, report, clear } = useReportedFailure();
  const generation = useRef(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (cursor?: string) => {
    const requested = generation.current;
    setLoading(true);
    clear();
    if (!cursor) { setEntries(undefined); setNextCursor(undefined); }
    try {
      const page = await api.dependantNotifications(dependant.personId, cursor);
      if (requested !== generation.current) return;
      setEntries((current) => cursor ? [...(current ?? []), ...page.items] : page.items);
      setNextCursor(page.nextCursor ?? undefined);
    } catch (failure) {
      if (requested !== generation.current) return;
      if (relationshipChanged(failure)) await refused(failure);
      else report(failure);
    } finally {
      if (requested === generation.current) setLoading(false);
    }
  }, [dependant.personId, refused, report, clear]);

  useEffect(() => {
    generation.current += 1;
    void load();
    return () => { generation.current += 1; };
  }, [load, revision]);

  return <section data-testid="dependant-messages" aria-labelledby="dependant-messages-title" className="grid gap-3">
    <h3 id="dependant-messages-title" className="text-xl font-semibold">{t("dependants.messages")}</h3>
    <p className="text-muted text-sm">{t("dependants.messagesReadOnly", { name })}</p>
    {error && <LoadFailure message={error} retry={() => void load()} />}
    {loading && !entries && <p role="status">{t("status.loading")}</p>}
    {entries && club && (entries.length === 0
      ? <p data-testid="dependant-messages-empty" className="text-muted">{t("dependants.noMessages", { name })}</p>
      : <ul data-testid="dependant-notifications" className="grid gap-3">
        {entries.map((notification) => <NotificationEntry key={notification.id} notification={notification}
          timeZone={club.timeZone} t={t} language={i18n.language} />)}
      </ul>)}
    {nextCursor && <Button variant="secondary" data-testid="dependant-load-more-messages" className="justify-self-start" disabled={loading}
      onClick={() => void load(nextCursor)}>{t("dependants.loadMoreMessages")}</Button>}
  </section>;
}

function DependantCredentials({ dependant, refused, acted }: {
  dependant: Dependant; refused: (cause: unknown) => Promise<void>; acted: () => void;
}) {
  const { t } = useTranslation();
  const name = nameOf(dependant);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [proving, setProving] = useState(false);
  const [proofFailure, setProofFailure] = useState<string>();
  const { message: error, report, clear } = useReportedFailure();

  async function request(): Promise<boolean> {
    try {
      await api.requestDependantCredentials(dependant.personId);
      clear();
      acted();
      setSent(true);
      return true;
    } catch (failure) {
      if (failure instanceof ApiError && failure.problem?.type === RECENT_AUTH) {
        setProofFailure(undefined);
        setProving(true);
      } else if (relationshipChanged(failure)) {
        await refused(failure);
      } else {
        report(failure);
      }
      return false;
    }
  }

  async function start() {
    setPending(true);
    setSent(false);
    try { await request(); } finally { setPending(false); }
  }

  async function prove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("dependant-reauthentication-password");
    if (typeof password !== "string") return;
    setPending(true);
    try {
      await api.reauthenticate(password);
      setProving(false);
      await request();
    } catch (failure) {
      setProofFailure(problemMessage(failure, t));
    } finally {
      setPending(false);
    }
  }

  return <section data-testid="dependant-credentials" aria-labelledby="dependant-credentials-title" className="grid gap-3">
    <h3 id="dependant-credentials-title" className="text-xl font-semibold">{t("dependants.credentials")}</h3>
    <p className="text-muted text-sm">{t("dependants.credentialsExplain", { name })}</p>
    {error && <Alert>{error}</Alert>}
    {sent && <SuccessFeedback testId="dependant-credentials-sent">{t("dependants.credentialsSent", { name })}</SuccessFeedback>}
    <Button variant="secondary" data-testid="request-dependant-credentials" className="justify-self-start" disabled={pending}
            onClick={() => void start()}>{t("dependants.requestCredentials")}</Button>
    {proving && <Modal labelledBy="dependant-reauthentication-title" closed={() => setProving(false)}>
      <form className="grid gap-4" onSubmit={(event) => void prove(event)}>
        <h2 id="dependant-reauthentication-title" className="text-2xl font-bold">{t("accountSecurity.reauthenticateTitle")}</h2>
        <p>{t("accountSecurity.reauthenticate")}</p>
        {proofFailure && <Alert>{proofFailure}</Alert>}
        <TextField id="dependant-reauthentication-password" name="dependant-reauthentication-password" type="password"
                   autoComplete="current-password" required label={t("auth.password")} />
        <Button variant="primary" disabled={pending} type="submit" data-testid="dependant-reauthentication-submit">{t("accountSecurity.continue")}</Button>
      </form>
    </Modal>}
  </section>;
}
