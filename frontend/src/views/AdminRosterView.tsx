import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { api, type MembershipType, type RosterEntry } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";

const NAME_LENGTH = 60;
const EMAIL_LENGTH = 120;
const PAGE_SIZE = 50;

type Translate = (key: string, values?: Record<string, unknown>) => string;

function accountLabel(entry: RosterEntry, t: Translate): string {
  if (!entry.accountId) return t("admin.roster.noAccount");
  return entry.enabled ? t("admin.roster.accountActive") : t("admin.roster.accountDisabled");
}

// membershipTypeId stays set once a membership has ended, naming the type last held, so a column
// reading it alone would show everybody who ever left as a current member.
function membershipLabel(entry: RosterEntry, names: Map<string, string>, t: Translate): string {
  if (!entry.membershipTypeId) return "—";
  if (entry.membershipEndedOn) return t("admin.roster.membershipEnded", { date: entry.membershipEndedOn });
  return names.get(entry.membershipTypeId) ?? entry.membershipTypeId;
}

export function AdminRosterView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<RosterEntry[]>();
  const [types, setTypes] = useState<MembershipType[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [query, setQuery] = useState<string>();
  const [membershipTypeId, setMembershipTypeId] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const reportError = useCallback((failure: unknown) => setError(problemMessage(failure, t)), [t]);

  useEffect(() => {
    void Promise.all([api.roster(undefined, undefined, PAGE_SIZE, undefined), api.membershipTypes()])
      .then(([page, membershipTypes]) => {
        setEntries(page.entries);
        setCursor(page.nextCursor ?? undefined);
        setTypes(membershipTypes);
      })
      .catch(reportError);
  }, [reportError]);

  async function read(term: string | undefined, typeId: string | undefined) {
    if (pending) return;
    setPending(true);
    try {
      const page = await api.roster(term, undefined, PAGE_SIZE, typeId);
      setQuery(term);
      setMembershipTypeId(typeId);
      setEntries(page.entries);
      setCursor(page.nextCursor ?? undefined);
      setError(undefined);
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  async function readNextPage() {
    if (pending) return;
    setPending(true);
    try {
      const page = await api.roster(query, cursor, PAGE_SIZE, membershipTypeId);
      setEntries((current) => [...(current ?? []), ...page.entries]);
      setCursor(page.nextCursor ?? undefined);
      setError(undefined);
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = formString(new FormData(event.currentTarget), "query").trim();
    await read(term || undefined, membershipTypeId);
  }

  async function createPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const created = await api.createPerson({
        firstName: formString(form, "firstName"),
        lastName: formString(form, "lastName"),
        email: formString(form, "email")
      });
      await navigate(`/admin/roster/${created.personId}`);
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  const typeNames = new Map(types.map((type) => [type.id, type.name]));

  return <section data-testid="admin-roster-view" className="surface-panel grid w-full max-w-7xl gap-8 self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-3xl font-bold">{t("admin.roster.title")}</h1>
    {!entries
      ? (error ? <Alert>{error}</Alert> : <p role="status">{t("status.loading")}</p>)
      : <>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <form noValidate onSubmit={(event) => void search(event)} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <TextField data-testid="roster-search" name="query" maxLength={NAME_LENGTH} label={t("admin.roster.search")} />
            <Button data-testid="roster-search-submit" disabled={pending} type="submit">{t("admin.roster.searchSubmit")}</Button>
          </form>
          <label className="grid gap-2 font-medium">
            {t("admin.roster.filter")}
            <select
              data-testid="roster-filter"
              className="form-control rounded-lg border px-3 py-3 outline-none"
              value={membershipTypeId ?? ""}
              onChange={(event) => void read(query, event.target.value || undefined)}
            >
              <option value="">{t("admin.roster.filterAll")}</option>
              {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </label>
        </div>
        <section className="grid gap-4">
          <h2 className="text-2xl font-bold">{t("admin.roster.people")}</h2>
          {entries.length === 0
            ? <p data-testid="roster-empty">{t("admin.roster.empty")}</p>
            : <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr>
                    <th className="border-b p-2">{t("admin.roster.columnName")}</th>
                    <th className="border-b p-2">{t("admin.roster.columnUsername")}</th>
                    <th className="border-b p-2">{t("admin.roster.columnAccount")}</th>
                    <th className="border-b p-2">{t("admin.roster.columnMembership")}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => <tr key={entry.personId} data-testid={`roster-row-${entry.personId}`}>
                    <td className="border-b p-2">
                      <Link data-testid={`person-link-${entry.personId}`} className="font-semibold underline" to={`/admin/roster/${entry.personId}`}>
                        {`${entry.lastName}, ${entry.firstName}`}
                      </Link>
                    </td>
                    <td className="border-b p-2">{entry.username ?? "—"}</td>
                    <td data-testid={`roster-account-${entry.personId}`} className="border-b p-2">{accountLabel(entry, t)}</td>
                    <td data-testid={`roster-membership-${entry.personId}`} className="border-b p-2">{membershipLabel(entry, typeNames, t)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>}
          {cursor && <Button data-testid="roster-load-more" disabled={pending} className="justify-self-start" type="button" onClick={() => void readNextPage()}>{t("admin.roster.loadMore")}</Button>}
        </section>
        <form noValidate onSubmit={(event) => void createPerson(event)} className="surface-subtle grid gap-3 rounded-xl border p-4">
          <h2 className="text-2xl font-bold">{t("admin.roster.newPerson")}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <TextField data-testid="new-person-first-name" disabled={pending} name="firstName" maxLength={NAME_LENGTH} label={t("admin.roster.firstName")} />
            <TextField data-testid="new-person-last-name" disabled={pending} name="lastName" maxLength={NAME_LENGTH} label={t("admin.roster.lastName")} />
            <TextField data-testid="new-person-email" disabled={pending} name="email" type="email" maxLength={EMAIL_LENGTH} label={t("admin.roster.email")} />
          </div>
          <Button data-testid="create-person" disabled={pending} className="justify-self-start" type="submit">{t("admin.create")}</Button>
        </form>
      </>}
  </section>;
}

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
