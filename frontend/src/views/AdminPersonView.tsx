import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { api, type MembershipType, type PersonRequest, type Role, type RosterEntry } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { TextField } from "../components/TextField";
import { formString } from "../forms/formString";

const roles: Role[] = [
  "MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER", "TREASURER", "ADMIN"
];

const NAME_LENGTH = 60;
const EMAIL_LENGTH = 120;
const USERNAME_LENGTH = 60;
const PASSWORD_LENGTH = 200;

export function AdminPersonView() {
  const { t } = useTranslation();
  const { personId = "" } = useParams();
  const [entry, setEntry] = useState<RosterEntry>();
  const [types, setTypes] = useState<MembershipType[]>([]);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [pending, setPending] = useState(false);

  const reportError = useCallback((failure: unknown) => {
    setSuccess(undefined);
    setError(problemMessage(failure, t));
  }, [t]);

  useEffect(() => {
    void Promise.all([api.person(personId), api.membershipTypes()])
      .then(([person, membershipTypes]) => {
        setEntry(person);
        setTypes(membershipTypes);
      })
      .catch(reportError);
  }, [personId, reportError]);

  async function mutate(change: () => Promise<RosterEntry>): Promise<RosterEntry | undefined> {
    if (pending) return undefined;
    setPending(true);
    try {
      const changed = await change();
      setEntry(changed);
      setError(undefined);
      setSuccess(t("admin.roster.saved"));
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
            disabled={pending}
            saveRoles={(chosen) => mutate(() => api.changeAccountRoles(personId, chosen))}
            saveUsername={(username) => mutate(() => api.changeAccountUsername(personId, username))}
            saveLocale={(locale) => mutate(() => api.changeAccountLocale(personId, locale))}
            resetPassword={(password) => mutate(() => api.resetAccountPassword(personId, password))}
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

function AccountSection({ entry, disabled, saveRoles, saveUsername, saveLocale, resetPassword, toggleAccount }: {
  entry: RosterEntry;
  disabled: boolean;
  saveRoles: (roles: Role[]) => Saved;
  saveUsername: (username: string) => Saved;
  saveLocale: (locale: string) => Saved;
  resetPassword: (oneTimePassword: string) => Saved;
  toggleAccount: () => Saved;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState(entry.username ?? "");
  const [locale, setLocale] = useState(entry.locale ?? "de");
  const [chosenRoles, setChosenRoles] = useState(entry.roles);
  const [oneTimePassword, setOneTimePassword] = useState("");

  async function reset() {
    if (await resetPassword(oneTimePassword)) setOneTimePassword("");
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
        <select data-testid="account-locale" disabled={disabled} className="form-control rounded-lg border px-3 py-2" value={locale} onChange={(event) => setLocale(event.target.value)}>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </label>
      <Button data-testid="save-locale" disabled={disabled} className="self-end" type="button" onClick={() => void saveLocale(locale)}>{t("admin.save")}</Button>
    </div>
    <RoleCheckboxes testIdPrefix="account-roles" disabled={disabled} selected={chosenRoles} changed={setChosenRoles} />
    <Button data-testid="save-roles" disabled={disabled} className="justify-self-start" type="button" onClick={() => void saveRoles(chosenRoles)}>{t("admin.save")}</Button>
    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
      <TextField data-testid="account-password" disabled={disabled} autoComplete="off" maxLength={PASSWORD_LENGTH} label={t("admin.roster.oneTimePassword")} value={oneTimePassword} onChange={(event) => setOneTimePassword(event.target.value)} />
      <Button data-testid="reset-password" disabled={disabled || !oneTimePassword} className="self-end" type="button" onClick={() => void reset()}>{t("admin.roster.resetPassword")}</Button>
    </div>
    <Button data-testid="toggle-account" disabled={disabled} className="justify-self-start" type="button" onClick={() => void toggleAccount()}>{t(entry.enabled ? "admin.deactivate" : "admin.activate")}</Button>
  </section>;
}

function AccountCreateSection({ entry, disabled, create }: {
  entry: RosterEntry;
  disabled: boolean;
  create: (request: { username: string; oneTimePassword: string; roles: Role[] }) => Saved;
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
      oneTimePassword: formString(form, "oneTimePassword"),
      roles: form.getAll("roles") as Role[]
    });
  }
  return <form noValidate onSubmit={submit} className="surface-subtle grid gap-3 rounded-xl border p-4">
    <h2 className="text-2xl font-bold">{t("admin.roster.newAccount")}</h2>
    <div className="grid gap-3 md:grid-cols-2">
      <TextField data-testid="new-account-username" disabled={disabled} autoComplete="off" name="username" maxLength={USERNAME_LENGTH} label={t("admin.roster.username")} />
      <TextField data-testid="new-account-password" disabled={disabled} autoComplete="off" name="oneTimePassword" maxLength={PASSWORD_LENGTH} label={t("admin.roster.oneTimePassword")} />
    </div>
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

