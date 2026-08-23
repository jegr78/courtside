import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { api, type ClubConfig, type MembershipType, type PersonRequest, type Role, type RosterEntry } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { LocaleSelect } from "../components/LocaleSelect";
import { Modal } from "../components/Modal";
import { TextField } from "../components/TextField";
import { formString } from "../forms/formString";

const roles: Role[] = [
  "MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER", "TREASURER", "ADMIN"
];

const NAME_LENGTH = 60;
const EMAIL_LENGTH = 120;
const USERNAME_LENGTH = 60;

export function AdminPersonView() {
  const { t } = useTranslation();
  const { personId = "" } = useParams();
  const [entry, setEntry] = useState<RosterEntry>();
  const [types, setTypes] = useState<MembershipType[]>([]);
  const [club, setClub] = useState<ClubConfig>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [pending, setPending] = useState(false);

  const reportError = useCallback((failure: unknown) => {
    setSuccess(undefined);
    setError(problemMessage(failure, t));
  }, [t]);

  useEffect(() => {
    void Promise.all([api.person(personId), api.membershipTypes(), api.config()])
      .then(([person, membershipTypes, configuration]) => {
        setEntry(person);
        setTypes(membershipTypes);
        setClub(configuration);
      })
      .catch(reportError);
  }, [personId, reportError]);

  async function mutate(change: () => Promise<RosterEntry>,
                       message = "admin.roster.saved"): Promise<RosterEntry | undefined> {
    if (pending) return undefined;
    setPending(true);
    try {
      const changed = await change();
      setEntry(changed);
      setError(undefined);
      setSuccess(t(message));
      return changed;
    } catch (failure) {
      reportError(failure);
      return undefined;
    } finally {
      setPending(false);
    }
  }

  return <section data-testid="admin-person-view" className="surface-panel grid w-full max-w-5xl gap-8 self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-3xl font-bold">{entry ? `${entry.firstName} ${entry.lastName}` : t("admin.person.title")}</h1>
      <Link data-testid="back-to-roster" to="/admin/roster" className="font-semibold underline">{t("admin.person.backToRoster")}</Link>
    </div>
    {!entry
      ? (error ? <Alert>{error}</Alert> : <p role="status">{t("status.loading")}</p>)
      : <>
        {error && <Alert>{error}</Alert>}
        {success && <Alert tone="success">{success}</Alert>}
        <PersonSection entry={entry} disabled={pending} save={(person) => mutate(() => api.changePerson(personId, person))} />
        <MembershipSection
          entry={entry}
          types={types}
          disabled={pending}
          save={(membership) => mutate(() => api.assignMembership(personId, membership))}
        />
        {entry.accountId
          ? <AccountSection
            entry={entry}
            club={club}
            disabled={pending}
            saveRoles={(chosen) => mutate(() => api.changeAccountRoles(personId, chosen))}
            saveUsername={(username) => mutate(() => api.changeAccountUsername(personId, username))}
            saveLocale={(locale) => mutate(() => api.changeAccountLocale(personId, locale))}
            sendCredentials={() => mutate(() => api.requestAccountCredentials(personId), "admin.person.credentialsSent")}
            toggleAccount={() => mutate(() => api.setAccountActive(personId, !entry.enabled))}
          />
          : <AccountCreateSection
            entry={entry}
            disabled={pending}
            create={(request) => mutate(() => api.createAccount(personId, request))}
          />}
        <Link data-testid="person-audit-link" className="font-semibold underline" to={`/admin/audit?subjectId=${personId}`}>
          {t("admin.person.auditLink")}
        </Link>
      </>}
  </section>;
}

type Saved = Promise<RosterEntry | undefined>;

function PersonSection({ entry, disabled, save }: { entry: RosterEntry; disabled: boolean; save: (person: PersonRequest) => Saved }) {
  const { t } = useTranslation();
  const [person, setPerson] = useState<PersonRequest>({
    firstName: entry.firstName, lastName: entry.lastName, email: entry.email
  });
  return <section className="surface-subtle grid gap-3 rounded-xl border p-4">
    <h2 className="text-2xl font-bold">{t("admin.person.person")}</h2>
    <div className="grid gap-3 md:grid-cols-3">
      <TextField data-testid="person-first-name" disabled={disabled} maxLength={NAME_LENGTH} label={t("admin.roster.firstName")} value={person.firstName} onChange={(event) => setPerson({ ...person, firstName: event.target.value })} />
      <TextField data-testid="person-last-name" disabled={disabled} maxLength={NAME_LENGTH} label={t("admin.roster.lastName")} value={person.lastName} onChange={(event) => setPerson({ ...person, lastName: event.target.value })} />
      <TextField data-testid="person-email" disabled={disabled} type="email" maxLength={EMAIL_LENGTH} label={t("admin.roster.email")} value={person.email ?? ""} onChange={(event) => setPerson({ ...person, email: event.target.value || null })} />
    </div>
    <Button data-testid="save-person" disabled={disabled} className="justify-self-start" type="button" onClick={() => void save(person)}>{t("admin.save")}</Button>
  </section>;
}

interface Membership {
  membershipTypeId: string;
  startedOn: string | null;
  endedOn: string | null;
}

function MembershipSection({ entry, types, disabled, save }: {
  entry: RosterEntry;
  types: MembershipType[];
  disabled: boolean;
  save: (membership: Membership) => Saved;
}) {
  const { t } = useTranslation();
  const [typeId, setTypeId] = useState(entry.membershipTypeId ?? "");
  const [startedOn, setStartedOn] = useState(entry.membershipStartedOn ?? "");
  const [endedOn, setEndedOn] = useState(entry.membershipEndedOn ?? "");
  const [ending, setEnding] = useState(false);
  const [chosenEnd, setChosenEnd] = useState(entry.membershipEndedOn ?? "");
  const running = Boolean(entry.membershipTypeId) && !entry.membershipEndedOn;

  async function endMembership() {
    const saved = await save({ membershipTypeId: typeId, startedOn: startedOn || null, endedOn: chosenEnd || null });
    if (saved) {
      setEndedOn(saved.membershipEndedOn ?? "");
      setEnding(false);
    }
  }

  return <section className="surface-subtle grid gap-3 rounded-xl border p-4">
    <h2 className="text-2xl font-bold">{t("admin.person.membership")}</h2>
    <div className="grid gap-3 md:grid-cols-3">
      <label className="grid gap-2 font-medium">
        {t("admin.person.membershipType")}
        <select data-testid="membership-type" disabled={disabled} className="form-control rounded-lg border px-3 py-3 outline-none" value={typeId} onChange={(event) => setTypeId(event.target.value)}>
          <option value="">{t("admin.person.noMembershipType")}</option>
          {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
        </select>
      </label>
      <TextField data-testid="membership-started-on" disabled={disabled} type="date" label={t("admin.person.startedOn")} value={startedOn} onChange={(event) => setStartedOn(event.target.value)} />
      <TextField data-testid="membership-ended-on" disabled={disabled} type="date" label={t("admin.person.endedOn")} value={endedOn} onChange={(event) => setEndedOn(event.target.value)} />
    </div>
    <div className="flex flex-wrap gap-3">
      <Button data-testid="save-membership" disabled={disabled || !typeId} type="button" onClick={() => void save({ membershipTypeId: typeId, startedOn: startedOn || null, endedOn: endedOn || null })}>{t("admin.save")}</Button>
      {running && <Button data-testid="end-membership" disabled={disabled} type="button" onClick={() => setEnding(true)}>{t("admin.person.endMembership")}</Button>}
    </div>
    {ending && <Modal labelledBy="end-membership-title" closed={() => setEnding(false)}>
      <div className="grid gap-4">
        <h2 id="end-membership-title" className="text-2xl font-bold">{t("admin.person.endMembershipTitle")}</h2>
        <p>{t("admin.person.endMembershipExplain")}</p>
        <TextField data-testid="end-membership-date" type="date" label={t("admin.person.endedOn")} value={chosenEnd} onChange={(event) => setChosenEnd(event.target.value)} />
        <div className="flex flex-wrap gap-3">
          <Button data-testid="confirm-end-membership" disabled={disabled || !chosenEnd} type="button" onClick={() => void endMembership()}>{t("admin.person.endMembership")}</Button>
          <Button data-testid="cancel-end-membership" type="button" onClick={() => setEnding(false)}>{t("admin.cancel")}</Button>
        </div>
      </div>
    </Modal>}
  </section>;
}

function AccountSection({ entry, club, disabled, saveRoles, saveUsername, saveLocale, sendCredentials, toggleAccount }: {
  entry: RosterEntry;
  club: ClubConfig | undefined;
  disabled: boolean;
  saveRoles: (roles: Role[]) => Saved;
  saveUsername: (username: string) => Saved;
  saveLocale: (locale: string) => Saved;
  sendCredentials: () => Saved;
  toggleAccount: () => Saved;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState(entry.username ?? "");
  const [locale, setLocale] = useState(entry.locale ?? club?.defaultLocale ?? "");
  const [chosenRoles, setChosenRoles] = useState(entry.roles);
  const [replacing, setReplacing] = useState(false);

  // Only a chosen password can be destroyed by sending: the other three states have nothing to lose.
  function send() {
    if (entry.credentialState === "PASSWORD_CHOSEN") {
      setReplacing(true);
      return;
    }
    void sendCredentials();
  }

  async function replace() {
    await sendCredentials();
    setReplacing(false);
  }

  return <section className="surface-subtle grid gap-3 rounded-xl border p-4">
    <h2 className="text-2xl font-bold">{t("admin.person.account")}</h2>
    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
      <TextField data-testid="account-username" disabled={disabled} autoComplete="off" maxLength={USERNAME_LENGTH} label={t("admin.roster.username")} value={username} onChange={(event) => setUsername(event.target.value)} />
      <Button data-testid="save-username" disabled={disabled} className="self-end" type="button" onClick={() => void saveUsername(username)}>{t("admin.save")}</Button>
    </div>
    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
      <label className="grid gap-2 font-medium">
        {t("admin.person.accountLocale")}
        <LocaleSelect testId="account-locale" disabled={disabled} className="form-control rounded-lg border px-3 py-2" value={locale} supported={club?.supportedLocales} changed={setLocale} />
      </label>
      <Button data-testid="save-locale" disabled={disabled} className="self-end" type="button" onClick={() => void saveLocale(locale)}>{t("admin.save")}</Button>
    </div>
    <RoleCheckboxes testIdPrefix="account-roles" disabled={disabled} selected={chosenRoles} changed={setChosenRoles} />
    <Button data-testid="save-roles" disabled={disabled} className="justify-self-start" type="button" onClick={() => void saveRoles(chosenRoles)}>{t("admin.save")}</Button>
    <div className="grid gap-2">
      <span className="font-medium">{t("admin.person.credentialState")}</span>
      <p data-testid="credential-state" data-state={entry.credentialState ?? "AWAITING_CREDENTIAL"}
         className="text-muted text-sm">
        {t(`admin.person.credentialState.${entry.credentialState ?? "AWAITING_CREDENTIAL"}`)}
      </p>
      <CredentialDestination entry={entry} />
      <Button data-testid="send-credentials" disabled={disabled || !entry.enabled} className="justify-self-start" type="button" onClick={send}>{t("admin.person.sendCredentials")}</Button>
    </div>
    <Button data-testid="toggle-account" disabled={disabled} className="justify-self-start" type="button" onClick={() => void toggleAccount()}>{t(entry.enabled ? "admin.deactivate" : "admin.activate")}</Button>
    {replacing && <Modal labelledBy="replace-chosen-title" closed={() => setReplacing(false)}>
      <div className="grid gap-4">
        <h2 id="replace-chosen-title" className="text-2xl font-bold">{t("admin.person.replaceChosenTitle")}</h2>
        <p>{t("admin.person.replaceChosenExplain")}</p>
        <div className="flex flex-wrap gap-3">
          <Button data-testid="confirm-send-credentials" disabled={disabled} type="button" onClick={() => void replace()}>{t("admin.person.replaceChosenConfirm")}</Button>
          <Button data-testid="cancel-send-credentials" type="button" onClick={() => setReplacing(false)}>{t("admin.cancel")}</Button>
        </div>
      </div>
    </Modal>}
  </section>;
}

// The address is entered by somebody else and a typo only shows up as a member who never appears,
// so this is the last moment anybody checks it.
function CredentialDestination({ entry }: { entry: RosterEntry }) {
  const { t } = useTranslation();
  if (!entry.email) return null;
  return <p data-testid="credential-destination" className="text-muted text-sm">
    {t("admin.person.credentialsGoTo", { address: entry.email })}
    {(entry.addressSharedBy ?? 1) > 1
      && ` ${t("admin.person.addressSharedBy", { count: entry.addressSharedBy })}`}
  </p>;
}

function AccountCreateSection({ entry, disabled, create }: {
  entry: RosterEntry;
  disabled: boolean;
  create: (request: { username: string; roles: Role[] }) => Saved;
}) {
  const { t } = useTranslation();
  if (!entry.email) {
    return <section className="surface-subtle grid gap-3 rounded-xl border p-4">
      <h2 className="text-2xl font-bold">{t("admin.roster.newAccount")}</h2>
      <p data-testid="account-needs-address">{t("admin.person.accountNeedsAddress")}</p>
    </section>;
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void create({
      username: formString(form, "username"),
      roles: form.getAll("roles") as Role[]
    });
  }
  return <form noValidate onSubmit={submit} className="surface-subtle grid gap-3 rounded-xl border p-4">
    <h2 className="text-2xl font-bold">{t("admin.roster.newAccount")}</h2>
    <TextField data-testid="new-account-username" disabled={disabled} autoComplete="off" name="username" maxLength={USERNAME_LENGTH} label={t("admin.roster.username")} />
    <CredentialDestination entry={entry} />
    <RoleCheckboxes testIdPrefix="new-account-role" disabled={disabled} name="roles" selected={[]} />
    <Button data-testid="create-account" disabled={disabled} className="justify-self-start" type="submit">{t("admin.roster.newAccount")}</Button>
  </form>;
}

function RoleCheckboxes({ name, selected, disabled, changed, testIdPrefix }: {
  name?: string;
  selected: Role[];
  disabled: boolean;
  changed?: (roles: Role[]) => void;
  testIdPrefix: string;
}) {
  const { t } = useTranslation();
  function toggle(role: Role, checked: boolean) {
    changed?.(checked ? [...selected, role] : selected.filter((candidate) => candidate !== role));
  }
  return <fieldset className="grid gap-2">
    <legend className="font-medium">{t("admin.roster.roles")}</legend>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {roles.map((role) => <label key={role} className="flex items-center gap-3 font-medium">
        <input
          data-testid={`${testIdPrefix}-${role}`}
          name={name}
          disabled={disabled}
          type="checkbox"
          value={role}
          checked={changed ? selected.includes(role) : undefined}
          onChange={changed ? (event) => toggle(role, event.target.checked) : undefined}
        />
        {t(`role.${role}`)}
      </label>)}
    </div>
  </fieldset>;
}

