import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError, type GuardianGrant, type GuardianRelationship, type RosterEntry } from "../api/client";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { TextField } from "../components/TextField";
import { useReportedFailure } from "../failures/useReportedFailure";
import { PERSON_SEARCH_DEBOUNCE_MS, PERSON_SEARCH_MIN_LENGTH } from "../person-search";

const GUARDIAN_GRANTS: GuardianGrant[] = ["VIEW_BOOKINGS", "BOOK", "CANCEL_BOOKINGS", "READ_MESSAGES", "ACCOUNT_TASKS"];

const RECENT_AUTH = "urn:courtside:error:recent-authentication-required";

type Party = GuardianRelationship["guardian"];
type Editing = { relationship?: GuardianRelationship };

const fullName = (party: Pick<Party, "firstName" | "lastName">) => `${party.firstName} ${party.lastName}`;

export function GuardianshipsSection({ entry, disabled, stepUp }: {
  entry: RosterEntry;
  disabled: boolean;
  stepUp: (retry: () => Promise<void>) => void;
}) {
  const { t } = useTranslation();
  const personId = entry.personId;
  const { message: error, report, clear } = useReportedFailure();
  const [relationships, setRelationships] = useState<GuardianRelationship[]>();
  const [editing, setEditing] = useState<Editing>();
  const [ending, setEnding] = useState<GuardianRelationship>();
  const [removing, setRemoving] = useState<GuardianRelationship>();
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState<string>();

  useEffect(() => {
    let active = true;
    void api.guardianRelationships(personId)
      .then((read) => { if (active) setRelationships(read); })
      .catch((failure: unknown) => { if (active) report(failure); });
    return () => { active = false; };
  }, [personId, report]);

  async function run(change: () => Promise<unknown>, done: () => void, message: string) {
    setPending(true);
    clear();
    setSuccess(undefined);
    const completed = async () => {
      await change();
      setRelationships(await api.guardianRelationships(personId));
      done();
      setSuccess(t(message));
    };
    try {
      await completed();
    } catch (failure) {
      if (failure instanceof ApiError && failure.problem?.type === RECENT_AUTH) stepUp(completed);
      else report(failure);
    } finally {
      setPending(false);
    }
  }

  const busy = disabled || pending;
  const close = () => { clear(); setEditing(undefined); setEnding(undefined); setRemoving(undefined); };
  const dialogOpen = editing !== undefined || ending !== undefined || removing !== undefined;

  return <section data-testid="person-guardianships" aria-labelledby="person-guardianships-title" className="grid gap-3 rounded-xl border p-4">
    <h2 id="person-guardianships-title" className="text-2xl font-bold">{t("admin.person.guardianships")}</h2>
    <p className="text-muted text-sm">{t("admin.person.guardianshipsExplain")}</p>
    {error && !dialogOpen && <Alert>{error}</Alert>}
    {success && !dialogOpen && <SuccessFeedback testId="guardianship-success">{success}</SuccessFeedback>}
    {relationships && (relationships.length === 0
      ? <p data-testid="guardianships-none" className="text-muted">{t("admin.person.guardianshipsNone")}</p>
      : <ul data-testid="guardianships-list" className="grid gap-2">
        {relationships.map((relationship) => {
          const asGuardian = relationship.guardian.personId === personId;
          const other = asGuardian ? relationship.dependant : relationship.guardian;
          const state = relationship.state === "RUNNING" ? "running" : "ended";
          return <li key={relationship.id} data-testid={`guardianship-${relationship.id}`} data-state={state}
                     className="grid gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 break-words font-semibold">
                {t(asGuardian ? "admin.person.guardianOf" : "admin.person.dependantOf", { name: fullName(other) })}
              </span>
              <span data-testid={`guardianship-state-${relationship.id}`} className="text-sm font-medium">
                {t(`admin.person.guardianshipState.${state}`)}
              </span>
            </div>
            <span className="text-muted text-sm">
              {relationship.endedOn
                ? t("admin.person.guardianshipRange", { startedOn: relationship.startedOn, endedOn: relationship.endedOn })
                : t("admin.person.guardianshipOpen", { startedOn: relationship.startedOn })}
            </span>
            <ul data-testid={`guardianship-grants-${relationship.id}`} className="flex flex-wrap gap-2">
              {GUARDIAN_GRANTS.filter((grant) => relationship.grants.includes(grant)).map((grant) =>
                <li key={grant} data-grant={grant} className="rounded-full border px-2 text-sm">{t(`guardianGrant.${grant}`)}</li>)}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" data-testid={`change-guardianship-${relationship.id}`} disabled={busy} type="button"
                      onClick={() => { clear(); setEditing({ relationship }); }}>{t("admin.person.changeGuardianship")}</Button>
              {relationship.state === "RUNNING" && <Button variant="secondary" data-testid={`end-guardianship-${relationship.id}`} disabled={busy} type="button"
                      onClick={() => { clear(); setEnding(relationship); }}>{t("admin.person.endGuardianship")}</Button>}
              <Button variant="destructive" data-testid={`remove-guardianship-${relationship.id}`} disabled={busy} type="button"
                      onClick={() => { clear(); setRemoving(relationship); }}>{t("admin.person.removeGuardianship")}</Button>
            </div>
          </li>;
        })}
      </ul>)}
    <Button variant="secondary" data-testid="add-guardianship" disabled={busy || !relationships} className="justify-self-start" type="button"
            onClick={() => { clear(); setEditing({}); }}>{t("admin.person.addGuardianship")}</Button>
    {editing && <GuardianshipForm entry={entry} relationship={editing.relationship} pending={pending} error={error} closed={close}
      save={(grants, endedOn, other) => {
        const relationship = editing.relationship;
        void run(() => relationship
          ? api.changeGuardianRelationship(personId, relationship.id, { grants, endedOn })
          : api.createGuardianRelationship(personId, {
            guardianPersonId: other?.asGuardian ? personId : other?.personId ?? "",
            dependantPersonId: other?.asGuardian ? other.personId : personId,
            grants, endedOn
          }), () => setEditing(undefined), "admin.person.guardianshipSaved");
      }} />}
    {ending && <Modal labelledBy="end-guardianship-title" closed={close}>
      <div className="grid gap-4">
        <h2 id="end-guardianship-title" className="text-2xl font-bold">{t("admin.person.endGuardianshipTitle")}</h2>
        <p>{t("admin.person.endGuardianshipExplain", { guardian: fullName(ending.guardian), dependant: fullName(ending.dependant) })}</p>
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button variant="destructive-confirm" data-testid="confirm-end-guardianship" disabled={pending} type="button"
                  onClick={() => void run(() => api.endGuardianRelationship(personId, ending.id), () => setEnding(undefined), "admin.person.guardianshipEnded")}>
            {t("admin.person.endGuardianship")}
          </Button>
          <Button variant="secondary" data-testid="cancel-end-guardianship" type="button" onClick={close}>{t("admin.cancel")}</Button>
        </div>
      </div>
    </Modal>}
    {removing && <Modal labelledBy="remove-guardianship-title" closed={close}>
      <div className="grid gap-4">
        <h2 id="remove-guardianship-title" className="text-2xl font-bold">{t("admin.person.removeGuardianshipTitle")}</h2>
        <p>{t("admin.person.removeGuardianshipExplain")}</p>
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button variant="destructive-confirm" data-testid="confirm-remove-guardianship" disabled={pending} type="button"
                  onClick={() => void run(() => api.removeGuardianRelationship(personId, removing.id), () => setRemoving(undefined), "admin.person.guardianshipRemoved")}>
            {t("admin.person.removeGuardianship")}
          </Button>
          <Button variant="secondary" data-testid="cancel-remove-guardianship" type="button" onClick={close}>{t("admin.cancel")}</Button>
        </div>
      </div>
    </Modal>}
  </section>;
}

type Other = { personId: string; name: string; asGuardian: boolean };

function GuardianshipForm({ entry, relationship, pending, error, save, closed }: {
  entry: RosterEntry;
  relationship?: GuardianRelationship;
  pending: boolean;
  error?: string;
  save: (grants: GuardianGrant[], endedOn: string | null, other?: Other) => void;
  closed: () => void;
}) {
  const { t } = useTranslation();
  const [grants, setGrants] = useState<GuardianGrant[]>(relationship?.grants ?? []);
  const [endedOn, setEndedOn] = useState(relationship?.endedOn ?? "");
  const [asGuardian, setAsGuardian] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<RosterEntry[]>();
  const [chosen, setChosen] = useState<RosterEntry>();
  const { message: searchError, report: reportSearch, clear: clearSearch } = useReportedFailure();
  const name = `${entry.firstName} ${entry.lastName}`;

  useEffect(() => {
    const trimmed = query.trim();
    if (relationship || trimmed.length < PERSON_SEARCH_MIN_LENGTH) {
      setMatches(undefined);
      return;
    }
    let active = true;
    const timeout = window.setTimeout(() => {
      void api.roster({ query: trimmed, limit: 10 })
        .then((page) => {
          if (!active) return;
          clearSearch();
          setMatches(page.entries.filter((candidate) => candidate.personId !== entry.personId && candidate.accountId));
        })
        .catch((failure: unknown) => { if (active) reportSearch(failure); });
    }, PERSON_SEARCH_DEBOUNCE_MS);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [query, relationship, entry.personId, clearSearch, reportSearch]);

  function toggle(grant: GuardianGrant, granted: boolean) {
    setGrants((current) => granted ? [...current, grant] : current.filter((candidate) => candidate !== grant));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const ordered = GUARDIAN_GRANTS.filter((grant) => grants.includes(grant));
    save(ordered, endedOn || null, chosen && { personId: chosen.personId, name: `${chosen.firstName} ${chosen.lastName}`, asGuardian });
  }

  return <Modal labelledBy="guardianship-form-title" closed={closed}>
    <form className="grid gap-4" onSubmit={submit}>
      <h2 id="guardianship-form-title" className="text-2xl font-bold">
        {t(relationship ? "admin.person.changeGuardianshipTitle" : "admin.person.addGuardianshipTitle")}
      </h2>
      {error && <Alert>{error}</Alert>}
      {!relationship && <>
        <fieldset className="grid gap-2">
          <legend className="font-semibold">{t("admin.person.guardianshipDirection")}</legend>
          <label className="flex items-center gap-3">
            <input type="radio" name="guardianship-direction" data-testid="guardianship-as-dependant" className="size-5"
                   checked={!asGuardian} onChange={() => setAsGuardian(false)} />
            {t("admin.person.guardianshipAsDependant", { name })}
          </label>
          <label className="flex items-center gap-3">
            <input type="radio" name="guardianship-direction" data-testid="guardianship-as-guardian" className="size-5"
                   checked={asGuardian} onChange={() => setAsGuardian(true)} />
            {t("admin.person.guardianshipAsGuardian", { name })}
          </label>
        </fieldset>
        {chosen
          ? <div className="surface-raised flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2">
            <span data-testid="guardianship-chosen">{t("admin.person.guardianshipChosen", { name: `${chosen.firstName} ${chosen.lastName}` })}</span>
            <Button variant="secondary" data-testid="guardianship-choose-other" type="button" className="px-3 py-2"
                    onClick={() => { setChosen(undefined); setQuery(""); }}>{t("admin.person.guardianshipChooseOther")}</Button>
          </div>
          : <div className="grid gap-2">
            <TextField data-testid="guardianship-search" type="search" label={t("admin.person.guardianshipSearch")} value={query}
                       aria-describedby="guardianship-search-hint" onChange={(event) => setQuery(event.target.value)} />
            <p id="guardianship-search-hint" className="text-muted text-sm">{t("admin.person.guardianshipSearchHint")}</p>
            {searchError && <Alert>{searchError}</Alert>}
            {matches && (matches.length === 0
              ? <p data-testid="guardianship-no-match" className="text-muted">{t("admin.person.guardianshipNoMatch")}</p>
              : <ul className="grid gap-2">{matches.map((match) => <li key={match.personId}>
                <Button variant="secondary" type="button" data-testid="guardianship-match" data-person-id={match.personId} className="w-full text-left"
                        onClick={() => setChosen(match)}>
                  {t("admin.person.guardianshipChoose", { name: `${match.firstName} ${match.lastName}` })}
                </Button>
              </li>)}</ul>)}
          </div>}
      </>}
      <fieldset className="grid gap-2">
        <legend className="font-semibold">{t("admin.person.guardianshipGrants")}</legend>
        {GUARDIAN_GRANTS.map((grant) => <label key={grant} className="flex items-center gap-3">
          <input type="checkbox" className="size-5" data-testid={`guardianship-grant-${grant}`}
                 checked={grants.includes(grant)} onChange={(event) => toggle(grant, event.target.checked)} />
          {t(`guardianGrant.${grant}`)}
        </label>)}
      </fieldset>
      <TextField data-testid="guardianship-ended-on" type="date" label={t("admin.person.guardianshipEndedOn")} value={endedOn}
                 aria-describedby="guardianship-ended-on-hint" onChange={(event) => setEndedOn(event.target.value)} />
      <p id="guardianship-ended-on-hint" className="text-muted text-sm">{t("admin.person.guardianshipEndedOnHint")}</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" data-testid="save-guardianship" disabled={pending || grants.length === 0 || (!relationship && !chosen)} type="submit">
          {t("admin.person.saveGuardianship")}
        </Button>
        <Button variant="secondary" data-testid="cancel-guardianship" type="button" onClick={closed}>{t("admin.cancel")}</Button>
      </div>
    </form>
  </Modal>;
}
