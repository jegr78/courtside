import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, type Role, type RosterEntry } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";

const roles: Role[] = [
  "MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER", "TREASURER", "ADMIN"
];

export function AdminRosterView() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<RosterEntry[]>();
  const [cursor, setCursor] = useState<string>();
  const [query, setQuery] = useState<string>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const pendingRef = useRef(new Set<string>());
  const [pending, setPending] = useState(new Set<string>());

  const reportError = useCallback((failure: unknown) => {
    setSuccess(undefined);
    setError(problemMessage(failure, t));
  }, [t]);

  useEffect(() => {
    void api.roster(undefined, undefined)
      .then((page) => {
        setEntries(page.entries);
        setCursor(page.nextCursor ?? undefined);
      })
      .catch(reportError);
  }, [reportError]);

  function reportSuccess() {
    setError(undefined);
    setSuccess(t("admin.roster.saved"));
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

  function replaceEntry(changed: RosterEntry) {
    setEntries((current) => current?.map((entry) => entry.personId === changed.personId ? changed : entry));
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = "roster:page";
    if (!beginMutation(key)) return;
    const term = formString(new FormData(event.currentTarget), "query") || undefined;
    try {
      const page = await api.roster(term, undefined);
      setQuery(term);
      setEntries(page.entries);
      setCursor(page.nextCursor ?? undefined);
      setError(undefined);
      setSuccess(undefined);
    } catch (failure) {
      reportError(failure);
    } finally {
      endMutation(key);
    }
  }

  async function readNextPage() {
    const key = "roster:page";
    if (!beginMutation(key)) return;
    try {
      const page = await api.roster(query, cursor);
      setEntries((current) => [...(current ?? []), ...page.entries]);
      setCursor(page.nextCursor ?? undefined);
    } catch (failure) {
      reportError(failure);
    } finally {
      endMutation(key);
    }
  }

  async function mutate(key: string, change: () => Promise<RosterEntry>): Promise<boolean> {
    if (!beginMutation(key)) return false;
    try {
      replaceEntry(await change());
      reportSuccess();
      return true;
    } catch (failure) {
      reportError(failure);
      return false;
    } finally {
      endMutation(key);
    }
  }

  async function createPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = "person:new";
    if (!beginMutation(key)) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const created = await api.createPerson({
        firstName: formString(form, "firstName"),
        lastName: formString(form, "lastName"),
        email: formString(form, "email")
      });
      setEntries((current) => [...(current ?? []), created]);
      formElement.reset();
      reportSuccess();
    } catch (failure) {
      reportError(failure);
    } finally {
      endMutation(key);
    }
  }

  async function createAccount(personId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return mutate(`account:${personId}`, () => api.createAccount(personId, {
      username: formString(form, "username"),
      oneTimePassword: formString(form, "oneTimePassword"),
      roles: form.getAll("roles") as Role[]
    }));
  }

  if (error && !entries) return <Alert>{error}</Alert>;
  if (!entries) return <p role="status">{t("status.loading")}</p>;

  return <section data-testid="admin-roster-view" className="surface-panel grid w-full max-w-7xl gap-8 self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-3xl font-bold">{t("admin.roster.title")}</h1>
      <Link to="/" className="font-semibold underline">{t("nav.courts")}</Link>
    </div>
    {error && <Alert>{error}</Alert>}
    {success && <Alert tone="success">{success}</Alert>}
    <form noValidate onSubmit={(event) => void search(event)} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <TextField data-testid="roster-search" name="query" label={t("admin.roster.search")} />
      <Button data-testid="roster-search-submit" disabled={pending.has("roster:page")} type="submit">{t("admin.roster.searchSubmit")}</Button>
    </form>
    <section className="grid gap-4">
      <h2 className="text-2xl font-bold">{t("admin.roster.people")}</h2>
      {entries.length === 0 && <p>{t("admin.roster.empty")}</p>}
      {entries.map((entry) => <PersonCard
        key={entry.personId}
        entry={entry}
        disabled={pending.has(`person:${entry.personId}`)}
        accountDisabled={pending.has(`account:${entry.personId}`)}
        changed={replaceEntry}
        savePerson={() => mutate(`person:${entry.personId}`, () => api.changePerson(entry.personId, {
          firstName: entry.firstName, lastName: entry.lastName, email: entry.email
        }))}
        saveRoles={() => mutate(`account:${entry.personId}`, () => api.changeAccountRoles(entry.personId, entry.roles))}
        saveUsername={() => mutate(`account:${entry.personId}`, () => api.changeAccountUsername(entry.personId, entry.username ?? ""))}
        resetPassword={(oneTimePassword) => mutate(`account:${entry.personId}`, () => api.resetAccountPassword(entry.personId, oneTimePassword))}
        toggleAccount={() => mutate(`account:${entry.personId}`, () => api.setAccountActive(entry.personId, !entry.enabled))}
        createAccount={(event) => createAccount(entry.personId, event)}
      />)}
      {cursor && <Button data-testid="roster-load-more" disabled={pending.has("roster:page")} className="justify-self-start" type="button" onClick={() => void readNextPage()}>{t("admin.roster.loadMore")}</Button>}
    </section>
    <form noValidate onSubmit={(event) => void createPerson(event)} className="surface-subtle grid gap-3 rounded-xl border p-4">
      <h2 className="text-2xl font-bold">{t("admin.roster.newPerson")}</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <TextField data-testid="new-person-first-name" disabled={pending.has("person:new")} name="firstName" label={t("admin.roster.firstName")} />
        <TextField data-testid="new-person-last-name" disabled={pending.has("person:new")} name="lastName" label={t("admin.roster.lastName")} />
        <TextField data-testid="new-person-email" disabled={pending.has("person:new")} name="email" type="email" label={t("admin.roster.email")} />
      </div>
      <Button data-testid="create-person" disabled={pending.has("person:new")} className="justify-self-start" type="submit">{t("admin.create")}</Button>
    </form>
  </section>;
}

interface PersonCardProps {
  entry: RosterEntry;
  disabled: boolean;
  accountDisabled: boolean;
  changed: (entry: RosterEntry) => void;
  savePerson: () => Promise<boolean>;
  saveRoles: () => Promise<boolean>;
  saveUsername: () => Promise<boolean>;
  resetPassword: (oneTimePassword: string) => Promise<boolean>;
  toggleAccount: () => Promise<boolean>;
  createAccount: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
}

function PersonCard({ entry, disabled, accountDisabled, changed, savePerson, createAccount, ...account }: PersonCardProps) {
  const { t } = useTranslation();
  return <article aria-label={`${entry.firstName} ${entry.lastName}`} className="surface-subtle grid gap-4 rounded-xl border p-4">
    <div className="grid gap-3 md:grid-cols-3">
      <TextField data-testid={`person-first-name-${entry.personId}`} disabled={disabled} label={t("admin.roster.firstName")} value={entry.firstName} onChange={(event) => changed({ ...entry, firstName: event.target.value })} />
      <TextField data-testid={`person-last-name-${entry.personId}`} disabled={disabled} label={t("admin.roster.lastName")} value={entry.lastName} onChange={(event) => changed({ ...entry, lastName: event.target.value })} />
      <TextField data-testid={`person-email-${entry.personId}`} disabled={disabled} type="email" label={t("admin.roster.email")} value={entry.email} onChange={(event) => changed({ ...entry, email: event.target.value })} />
    </div>
    <Button data-testid={`save-person-${entry.personId}`} disabled={disabled} className="justify-self-start" type="button" onClick={() => void savePerson()}>{t("admin.save")}</Button>
    {entry.accountId
      ? <AccountEditor entry={entry} disabled={accountDisabled} changed={changed} {...account} />
      : <AccountCreateForm entry={entry} disabled={accountDisabled} create={createAccount} />}
  </article>;
}

function AccountEditor({ entry, disabled, changed, saveRoles, saveUsername, resetPassword, toggleAccount }: {
  entry: RosterEntry;
  disabled: boolean;
  changed: (entry: RosterEntry) => void;
  saveRoles: () => Promise<boolean>;
  saveUsername: () => Promise<boolean>;
  resetPassword: (oneTimePassword: string) => Promise<boolean>;
  toggleAccount: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [oneTimePassword, setOneTimePassword] = useState("");
  async function reset() {
    if (await resetPassword(oneTimePassword)) setOneTimePassword("");
  }
  return <div className="grid gap-3 border-t pt-4">
    <h3 className="font-bold">{t("admin.roster.account")}</h3>
    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
      <TextField data-testid={`account-username-${entry.personId}`} disabled={disabled} autoComplete="off" label={t("admin.roster.username")} value={entry.username ?? ""} onChange={(event) => changed({ ...entry, username: event.target.value })} />
      <Button data-testid={`save-username-${entry.personId}`} disabled={disabled} className="self-end" type="button" onClick={() => void saveUsername()}>{t("admin.save")}</Button>
    </div>
    <RoleCheckboxes testIdPrefix={`account-roles-${entry.personId}`} disabled={disabled} selected={entry.roles} changed={(chosen) => changed({ ...entry, roles: chosen })} />
    <Button data-testid={`save-roles-${entry.personId}`} disabled={disabled} className="justify-self-start" type="button" onClick={() => void saveRoles()}>{t("admin.save")}</Button>
    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
      <TextField data-testid={`account-password-${entry.personId}`} disabled={disabled} autoComplete="off" label={t("admin.roster.oneTimePassword")} value={oneTimePassword} onChange={(event) => setOneTimePassword(event.target.value)} />
      <Button data-testid={`reset-password-${entry.personId}`} disabled={disabled || !oneTimePassword} className="self-end" type="button" onClick={() => void reset()}>{t("admin.roster.resetPassword")}</Button>
    </div>
    <Button data-testid={`toggle-account-${entry.personId}`} disabled={disabled} className="justify-self-start" type="button" onClick={() => void toggleAccount()}>{t(entry.enabled ? "admin.deactivate" : "admin.activate")}</Button>
  </div>;
}

function AccountCreateForm({ entry, disabled, create }: {
  entry: RosterEntry;
  disabled: boolean;
  create: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  return <form noValidate onSubmit={(event) => void create(event)} className="grid gap-3 border-t pt-4">
    <h3 className="font-bold">{t("admin.roster.newAccount")}</h3>
    <div className="grid gap-3 md:grid-cols-2">
      <TextField data-testid={`new-account-username-${entry.personId}`} disabled={disabled} autoComplete="off" name="username" label={t("admin.roster.username")} />
      <TextField data-testid={`new-account-password-${entry.personId}`} disabled={disabled} autoComplete="off" name="oneTimePassword" label={t("admin.roster.oneTimePassword")} />
    </div>
    <RoleCheckboxes testIdPrefix={`new-account-role-${entry.personId}`} disabled={disabled} name="roles" selected={[]} />
    <Button data-testid={`create-account-${entry.personId}`} disabled={disabled} className="justify-self-start" type="submit">{t("admin.roster.newAccount")}</Button>
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

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
