import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type MembershipType, type Role, type RosterEntry, type RosterSortField,
  type RosterSortDirection } from "../api/client";
import { useReportedFailure } from "../failures/useReportedFailure";
import { Alert } from "../components/Alert";
import { LoadFailure } from "../components/LoadFailure";
import { useRetry } from "../failures/useRetry";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { formString } from "../forms/formString";
import { useUnsavedForm } from "../unsaved/useUnsavedForm";

const NAME_LENGTH = 60;
const EMAIL_LENGTH = 120;
const PAGE_SIZE = 20;
const ROLES: Role[] = ["MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER", "TREASURER", "ADMIN"];

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

function roleLabel(entry: RosterEntry, t: Translate): string {
  return entry.roles.length === 0 ? "—" : entry.roles.map((role) => t(`role.${role}`)).join(", ");
}

function SortableHeading({ field, active, direction, label, changed, disabled }: {
  field: RosterSortField; active: RosterSortField; direction: RosterSortDirection; label: string;
  changed: (field: RosterSortField) => void; disabled: boolean;
}) {
  const selected = field === active;
  return <th className="border-b p-2" aria-sort={selected ? (direction === "ASC" ? "ascending" : "descending") : "none"}>
    <button type="button" disabled={disabled} className="inline-flex items-center gap-2 underline disabled:no-underline" onClick={() => changed(field)}>
      {label}<span aria-hidden="true">{selected ? (direction === "ASC" ? "↑" : "↓") : "↕"}</span>
    </button>
  </th>;
}

export function AdminRosterView() {
  const { t } = useTranslation();
  const newPerson = useUnsavedForm("person:new");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedMembershipTypeId = searchParams.get("membershipTypeId") || undefined;
  const [entries, setEntries] = useState<RosterEntry[]>();
  const [types, setTypes] = useState<MembershipType[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [pageCursor, setPageCursor] = useState<string>();
  const [previousCursors, setPreviousCursors] = useState<(string | undefined)[]>([]);
  const [query, setQuery] = useState<string>();
  const [membershipTypeId, setMembershipTypeId] = useState<string | undefined>(requestedMembershipTypeId);
  const [role, setRole] = useState<Role>();
  const [sortBy, setSortBy] = useState<RosterSortField>("NAME");
  const [sortDirection, setSortDirection] = useState<RosterSortDirection>("ASC");
  const { message: error, report: reportError, clear } = useReportedFailure();
  const [pending, setPending] = useState(false);
  const [loadAttempt, retryLoad] = useRetry();

  useEffect(() => {
    let active = true;
    void Promise.all([api.roster({ limit: PAGE_SIZE,
      ...(requestedMembershipTypeId ? { membershipTypeId: requestedMembershipTypeId } : {}) }), api.membershipTypes()])
      .then(([page, membershipTypes]) => {
        if (!active) return;
        setMembershipTypeId(requestedMembershipTypeId);
        setEntries(page.entries);
        setNextCursor(page.nextCursor ?? undefined);
        setPageCursor(undefined);
        setPreviousCursors([]);
        setTypes(membershipTypes);
      })
      .catch((failure: unknown) => {
        if (active) reportError(failure);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, reportError, requestedMembershipTypeId]);

  async function read(term: string | undefined, typeId: string | undefined, selectedRole: Role | undefined,
    field: RosterSortField, direction: RosterSortDirection, requestedCursor?: string,
    history: (string | undefined)[] = []) {
    if (pending) return;
    setPending(true);
    try {
      const page = await api.roster({ limit: PAGE_SIZE, sortBy: field, sortDirection: direction,
        ...(term ? { query: term } : {}), ...(requestedCursor ? { cursor: requestedCursor } : {}),
        ...(typeId ? { membershipTypeId: typeId } : {}), ...(selectedRole ? { role: selectedRole } : {}) });
      setQuery(term);
      setMembershipTypeId(typeId);
      setRole(selectedRole);
      setSortBy(field);
      setSortDirection(direction);
      setEntries(page.entries);
      setNextCursor(page.nextCursor ?? undefined);
      setPageCursor(requestedCursor);
      setPreviousCursors(history);
      clear();
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  async function readNextPage() {
    if (!nextCursor) return;
    await read(query, membershipTypeId, role, sortBy, sortDirection, nextCursor,
      [...previousCursors, pageCursor]);
  }

  async function readPreviousPage() {
    if (previousCursors.length === 0) return;
    const requestedCursor = previousCursors.at(-1);
    await read(query, membershipTypeId, role, sortBy, sortDirection, requestedCursor,
      previousCursors.slice(0, -1));
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = formString(new FormData(event.currentTarget), "query").trim();
    await read(term || undefined, membershipTypeId, role, sortBy, sortDirection);
  }

  async function changeSort(field: RosterSortField) {
    const direction = field === sortBy && sortDirection === "ASC" ? "DESC" : "ASC";
    await read(query, membershipTypeId, role, field, direction);
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
        email: formString(form, "email") || null
      });
      newPerson.saved();
      await navigate(`/admin/roster/${created.personId}`, { state: { personCreated: true } });
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  const typeNames = new Map(types.map((type) => [type.id, type.name]));

  return <section data-testid="admin-roster-view" className="surface-panel grid gap-8 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-3xl font-bold">{t("admin.roster.title")}</h1>
    {!entries
      ? (error ? <LoadFailure message={error} retry={() => { clear(); retryLoad(); }} /> : <p role="status">{t("status.loading")}</p>)
      : <>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-end">
          <form noValidate onSubmit={(event) => void search(event)} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <TextField data-testid="roster-search" name="query" maxLength={NAME_LENGTH} label={t("admin.roster.search")} />
            <Button variant="secondary" data-testid="roster-search-submit" disabled={pending} type="submit">{t("admin.roster.searchSubmit")}</Button>
          </form>
          <label className="grid gap-2 font-medium">
            {t("admin.roster.filter")}
            <select
              data-testid="roster-filter"
              className="form-control rounded-lg border px-3 py-3"
              disabled={pending}
              value={membershipTypeId ?? ""}
              onChange={(event) => void read(query, event.target.value || undefined, role, sortBy, sortDirection)}
            >
              <option value="">{t("admin.roster.filterAll")}</option>
              {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </label>
          <label className="grid gap-2 font-medium">
            {t("admin.roster.roleFilter")}
            <select
              data-testid="roster-role-filter"
              className="form-control rounded-lg border px-3 py-3"
              disabled={pending}
              value={role ?? ""}
              onChange={(event) => void read(query, membershipTypeId,
                (event.target.value || undefined) as Role | undefined, sortBy, sortDirection)}
            >
              <option value="">{t("admin.roster.filterAll")}</option>
              {ROLES.map((item) => <option key={item} value={item}>{t(`role.${item}`)}</option>)}
            </select>
          </label>
        </div>
        <section className="grid gap-4">
          <h2 className="text-2xl font-bold">{t("admin.roster.people")}</h2>
          {entries.length === 0
            ? <p data-testid="roster-empty">{t("admin.roster.empty")}</p>
            : <div>
              <table className="block w-full border-collapse text-left sm:table sm:table-fixed">
                <thead className="sr-only sm:not-sr-only">
                  <tr>
                    <SortableHeading field="NAME" active={sortBy} direction={sortDirection} label={t("admin.roster.columnName")} disabled={pending} changed={(field) => void changeSort(field)} />
                    <SortableHeading field="USERNAME" active={sortBy} direction={sortDirection} label={t("admin.roster.columnUsername")} disabled={pending} changed={(field) => void changeSort(field)} />
                    <SortableHeading field="ACCOUNT" active={sortBy} direction={sortDirection} label={t("admin.roster.columnAccount")} disabled={pending} changed={(field) => void changeSort(field)} />
                    <SortableHeading field="MEMBERSHIP_TYPE" active={sortBy} direction={sortDirection} label={t("admin.roster.columnMembership")} disabled={pending} changed={(field) => void changeSort(field)} />
                    <SortableHeading field="ROLES" active={sortBy} direction={sortDirection} label={t("admin.roster.columnRoles")} disabled={pending} changed={(field) => void changeSort(field)} />
                  </tr>
                </thead>
                <tbody className="grid gap-3 sm:table-row-group">
                  {entries.map((entry) => <tr key={entry.personId} data-testid={`roster-row-${entry.personId}`} className="grid gap-2 rounded-xl border p-4 sm:table-row sm:rounded-none sm:border-0 sm:p-0">
                    <td className="grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 sm:table-cell sm:border-b sm:p-2">
                      <span aria-hidden="true" data-testid="roster-label-name" className="font-medium sm:hidden">{t("admin.roster.columnName")}</span>
                      <Link data-testid={`person-link-${entry.personId}`} className="min-w-0 break-words font-semibold underline" to={`/admin/roster/${entry.personId}`}>
                        {`${entry.lastName}, ${entry.firstName}`}
                      </Link>
                    </td>
                    <td className="grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 sm:table-cell sm:border-b sm:p-2">
                      <span aria-hidden="true" data-testid="roster-label-username" className="font-medium sm:hidden">{t("admin.roster.columnUsername")}</span>
                      <span className="min-w-0 [overflow-wrap:anywhere]">{entry.username ?? "—"}</span>
                    </td>
                    <td className="grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 sm:table-cell sm:border-b sm:p-2">
                      <span aria-hidden="true" data-testid="roster-label-account" className="font-medium sm:hidden">{t("admin.roster.columnAccount")}</span>
                      <span data-testid={`roster-account-${entry.personId}`} className="min-w-0 break-words">{accountLabel(entry, t)}</span>
                    </td>
                    <td className="grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 sm:table-cell sm:border-b sm:p-2">
                      <span aria-hidden="true" data-testid="roster-label-membership" className="font-medium sm:hidden">{t("admin.roster.columnMembership")}</span>
                      <span data-testid={`roster-membership-${entry.personId}`} className="min-w-0 break-words">{membershipLabel(entry, typeNames, t)}</span>
                    </td>
                    <td className="grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 sm:table-cell sm:border-b sm:p-2">
                      <span aria-hidden="true" data-testid="roster-label-roles" className="font-medium sm:hidden">{t("admin.roster.columnRoles")}</span>
                      <span data-testid={`roster-roles-${entry.personId}`} className="min-w-0 break-words">{roleLabel(entry, t)}</span>
                    </td>
                  </tr>)}
                </tbody>
              </table>
            </div>}
          <nav aria-label={t("admin.roster.pagination")} className="flex items-center gap-3">
            <Button variant="secondary" data-testid="roster-previous-page" disabled={pending || previousCursors.length === 0} type="button" onClick={() => void readPreviousPage()}>{t("admin.roster.previousPage")}</Button>
            <span data-testid="roster-page-number">{t("admin.roster.page", { page: previousCursors.length + 1 })}</span>
            <Button variant="secondary" data-testid="roster-next-page" disabled={pending || !nextCursor} type="button" onClick={() => void readNextPage()}>{t("admin.roster.nextPage")}</Button>
          </nav>
        </section>
        <form noValidate {...newPerson.form} onSubmit={(event) => void createPerson(event)} className="grid gap-3 rounded-xl border p-4">
          <h2 className="text-2xl font-bold">{t("admin.roster.newPerson")}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <TextField data-testid="new-person-first-name" disabled={pending} name="firstName" maxLength={NAME_LENGTH} label={t("admin.roster.firstName")} />
            <TextField data-testid="new-person-last-name" disabled={pending} name="lastName" maxLength={NAME_LENGTH} label={t("admin.roster.lastName")} />
            <TextField data-testid="new-person-email" disabled={pending} name="email" type="email" maxLength={EMAIL_LENGTH} label={t("admin.roster.email")} />
          </div>
          <Button variant="primary" data-testid="create-person" disabled={pending} className="justify-self-start" type="submit">{t("admin.create")}</Button>
        </form>
      </>}
  </section>;
}
