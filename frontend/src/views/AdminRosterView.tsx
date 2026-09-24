import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type CredentialState, type MembershipType, type Role, type RosterEntry, type RosterSortField,
  type RosterSortDirection } from "../api/client";
import { useReportedFailure } from "../failures/useReportedFailure";
import { Alert } from "../components/Alert";
import { LoadFailure } from "../components/LoadFailure";
import { useRetry } from "../failures/useRetry";
import { Button } from "../components/Button";
import { noticeColours } from "../components/noticeTones";
import { TextField } from "../components/TextField";
import { formString } from "../forms/formString";
import { useUnsavedForm } from "../unsaved/useUnsavedForm";

const NAME_LENGTH = 60;
const EMAIL_LENGTH = 120;
const PAGE_SIZE = 20;
const ROLES: Role[] = ["MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER", "TREASURER", "ADMIN"];
const CREDENTIAL_STATES: CredentialState[] = ["AWAITING_CREDENTIAL", "CREDENTIAL_ISSUED", "CREDENTIAL_EXPIRED", "PASSWORD_CHOSEN"];
const NOT_CHOSEN = "NOT_CHOSEN";
const SORT_FIELDS: { field: RosterSortField; label: string }[] = [
  { field: "NAME", label: "admin.roster.columnName" },
  { field: "USERNAME", label: "admin.roster.columnUsername" },
  { field: "ACCOUNT", label: "admin.roster.columnAccount" },
  { field: "MEMBERSHIP_TYPE", label: "admin.roster.columnMembership" },
  { field: "ROLES", label: "admin.roster.columnRoles" }
];

type AccessFilter = CredentialState | typeof NOT_CHOSEN;

interface Criteria {
  query?: string;
  membershipTypeId?: string;
  role?: Role;
  access?: AccessFilter;
  sortBy: RosterSortField;
  sortDirection: RosterSortDirection;
}
type AccountState = "active" | "disabled" | "none";

const TABLE_HEAD_FROM = "(width >= 640px)";

function subscribeToTableHead(changed: () => void) {
  const query = window.matchMedia(TABLE_HEAD_FROM);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
}

function isTableHeadShown(): boolean {
  return window.matchMedia(TABLE_HEAD_FROM).matches;
}

type Translate = (key: string, values?: Record<string, unknown>) => string;

function credentialStates(filter: AccessFilter | undefined): CredentialState[] | undefined {
  if (!filter) return undefined;
  return filter === NOT_CHOSEN ? CREDENTIAL_STATES.filter((state) => state !== "PASSWORD_CHOSEN") : [filter];
}

function accountState(entry: RosterEntry): AccountState {
  if (!entry.accountId) return "none";
  return entry.enabled ? "active" : "disabled";
}

const ACCOUNT_LABELS: Record<AccountState, string> = {
  active: "admin.roster.accountActive", disabled: "admin.roster.accountDisabled", none: "admin.roster.noAccount"
};

const ACCOUNT_MARKS: Record<AccountState, { symbol: string; look: string }> = {
  active: { symbol: "●", look: `border ${noticeColours("success")}` },
  disabled: { symbol: "⊘", look: `border-2 ${noticeColours("error")}` },
  none: { symbol: "○", look: "text-muted border border-dashed" }
};

function AccountMark({ entry, t }: { entry: RosterEntry; t: Translate }) {
  const state = accountState(entry);
  const mark = ACCOUNT_MARKS[state];
  return <span data-testid={`roster-account-${entry.personId}`} data-state={state}
    className={`inline-flex min-w-0 items-center gap-1.5 justify-self-start rounded-full px-2 py-0.5 text-sm font-semibold ${mark.look}`}>
    <span data-testid="roster-account-mark" aria-hidden="true">{mark.symbol}</span>
    <span className="break-words">{t(ACCOUNT_LABELS[state])}</span>
  </span>;
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

function SortableHeading({ field, active, direction, label, changed, disabled, focusable }: {
  field: RosterSortField; active: RosterSortField; direction: RosterSortDirection; label: string;
  changed: (field: RosterSortField) => void; disabled: boolean; focusable: boolean;
}) {
  const selected = field === active;
  return <th className="border-b p-2" aria-sort={selected ? (direction === "ASC" ? "ascending" : "descending") : "none"}>
    <button type="button" disabled={disabled} tabIndex={focusable ? undefined : -1} className="inline-flex items-center gap-2 underline disabled:no-underline" onClick={() => changed(field)}>
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
  const headVisible = useSyncExternalStore(subscribeToTableHead, isTableHeadShown, () => true);
  const [entries, setEntries] = useState<RosterEntry[]>();
  const [matching, setMatching] = useState(0);
  const [types, setTypes] = useState<MembershipType[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [pageCursor, setPageCursor] = useState<string>();
  const [previousCursors, setPreviousCursors] = useState<(string | undefined)[]>([]);
  const [criteria, setCriteria] = useState<Criteria>({ membershipTypeId: requestedMembershipTypeId, sortBy: "NAME", sortDirection: "ASC" });
  const { message: error, report: reportError, clear } = useReportedFailure();
  const [pending, setPending] = useState(false);
  const [loadAttempt, retryLoad] = useRetry();

  useEffect(() => {
    let active = true;
    void Promise.all([api.roster({ limit: PAGE_SIZE,
      ...(requestedMembershipTypeId ? { membershipTypeId: requestedMembershipTypeId } : {}) }), api.membershipTypes()])
      .then(([page, membershipTypes]) => {
        if (!active) return;
        setCriteria({ membershipTypeId: requestedMembershipTypeId, sortBy: "NAME", sortDirection: "ASC" });
        setEntries(page.entries);
        setMatching(page.matching);
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

  async function read(requested: Criteria, requestedCursor?: string, history: (string | undefined)[] = []) {
    if (pending) return;
    setPending(true);
    const states = credentialStates(requested.access);
    try {
      const page = await api.roster({ limit: PAGE_SIZE, sortBy: requested.sortBy, sortDirection: requested.sortDirection,
        ...(requested.query ? { query: requested.query } : {}), ...(requestedCursor ? { cursor: requestedCursor } : {}),
        ...(requested.membershipTypeId ? { membershipTypeId: requested.membershipTypeId } : {}),
        ...(requested.role ? { role: requested.role } : {}), ...(states ? { credentialStates: states } : {}) });
      setCriteria(requested);
      setEntries(page.entries);
      setMatching(page.matching);
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
    await read(criteria, nextCursor, [...previousCursors, pageCursor]);
  }

  async function readPreviousPage() {
    if (previousCursors.length === 0) return;
    await read(criteria, previousCursors.at(-1), previousCursors.slice(0, -1));
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = formString(new FormData(event.currentTarget), "query").trim();
    await read({ ...criteria, query: term || undefined });
  }

  async function changeSort(field: RosterSortField) {
    const direction = field === criteria.sortBy && criteria.sortDirection === "ASC" ? "DESC" : "ASC";
    await read({ ...criteria, sortBy: field, sortDirection: direction });
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
  const { sortBy, sortDirection } = criteria;

  return <section data-testid="admin-roster-view" className="surface-panel grid gap-8 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <h1 className="text-3xl font-bold">{t("admin.roster.title")}</h1>
    {!entries
      ? (error ? <LoadFailure message={error} retry={() => { clear(); retryLoad(); }} /> : <p role="status">{t("status.loading")}</p>)
      : <>
        {error && <Alert>{error}</Alert>}
        <form noValidate {...newPerson.form} onSubmit={(event) => void createPerson(event)} className="grid gap-3 rounded-xl border p-4">
          <h2 className="text-2xl font-bold">{t("admin.roster.newPerson")}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <TextField data-testid="new-person-first-name" disabled={pending} name="firstName" maxLength={NAME_LENGTH} label={t("admin.roster.firstName")} />
            <TextField data-testid="new-person-last-name" disabled={pending} name="lastName" maxLength={NAME_LENGTH} label={t("admin.roster.lastName")} />
            <TextField data-testid="new-person-email" disabled={pending} name="email" type="email" maxLength={EMAIL_LENGTH} label={t("admin.roster.email")} />
          </div>
          <Button variant="primary" data-testid="create-person" disabled={pending} className="justify-self-start" type="submit">{t("admin.create")}</Button>
        </form>
        <section className="grid gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-2xl font-bold">{t("admin.roster.people")}</h2>
            <p data-testid="roster-matching" aria-live="polite" className="text-muted font-semibold">{t("admin.roster.matching", { count: matching })}</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto] lg:items-end">
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
                value={criteria.membershipTypeId ?? ""}
                onChange={(event) => void read({ ...criteria, membershipTypeId: event.target.value || undefined })}
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
                value={criteria.role ?? ""}
                onChange={(event) => void read({ ...criteria, role: (event.target.value || undefined) as Role | undefined })}
              >
                <option value="">{t("admin.roster.filterAll")}</option>
                {ROLES.map((item) => <option key={item} value={item}>{t(`role.${item}`)}</option>)}
              </select>
            </label>
            <label className="grid gap-2 font-medium">
              {t("admin.roster.credentialFilter")}
              <select
                data-testid="roster-credential-filter"
                className="form-control rounded-lg border px-3 py-3"
                disabled={pending}
                value={criteria.access ?? ""}
                onChange={(event) => void read({ ...criteria, access: (event.target.value || undefined) as AccessFilter | undefined })}
              >
                <option value="">{t("admin.roster.filterAll")}</option>
                <option value={NOT_CHOSEN}>{t("admin.roster.credentialFilter.NOT_CHOSEN")}</option>
                {CREDENTIAL_STATES.map((state) => <option key={state} value={state}>{t(`admin.roster.credential.${state}`)}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:hidden">
            <label className="grid gap-2 font-medium">
              {t("admin.roster.sortField")}
              <select
                data-testid="roster-sort-field"
                className="form-control rounded-lg border px-3 py-3"
                disabled={pending}
                value={sortBy}
                onChange={(event) => void read({ ...criteria, sortBy: event.target.value as RosterSortField })}
              >
                {SORT_FIELDS.map(({ field, label }) => <option key={field} value={field}>{t(label)}</option>)}
              </select>
            </label>
            <label className="grid gap-2 font-medium">
              {t("admin.roster.sortDirection")}
              <select
                data-testid="roster-sort-direction"
                className="form-control rounded-lg border px-3 py-3"
                disabled={pending}
                value={sortDirection}
                onChange={(event) => void read({ ...criteria, sortDirection: event.target.value as RosterSortDirection })}
              >
                <option value="ASC">{t("admin.roster.sortDirection.ASC")}</option>
                <option value="DESC">{t("admin.roster.sortDirection.DESC")}</option>
              </select>
            </label>
          </div>
          {entries.length === 0
            ? <p data-testid="roster-empty">{t("admin.roster.empty")}</p>
            : <div>
              <table className="block w-full border-collapse text-left sm:table sm:table-fixed">
                <thead className="sr-only sm:not-sr-only">
                  <tr>
                    {SORT_FIELDS.slice(0, 3).map(({ field, label }) => <SortableHeading key={field} field={field} active={sortBy} direction={sortDirection} label={t(label)} disabled={pending} focusable={headVisible} changed={(changed) => void changeSort(changed)} />)}
                    <th className="border-b p-2">{t("admin.roster.columnCredential")}</th>
                    {SORT_FIELDS.slice(3).map(({ field, label }) => <SortableHeading key={field} field={field} active={sortBy} direction={sortDirection} label={t(label)} disabled={pending} focusable={headVisible} changed={(changed) => void changeSort(changed)} />)}
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
                      <AccountMark entry={entry} t={t} />
                    </td>
                    <td className="grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 sm:table-cell sm:border-b sm:p-2">
                      <span aria-hidden="true" data-testid="roster-label-credential" className="font-medium sm:hidden">{t("admin.roster.columnCredential")}</span>
                      <span data-testid={`roster-credential-${entry.personId}`} data-state={entry.credentialState ?? "NONE"} className="min-w-0 break-words">
                        {entry.credentialState ? t(`admin.roster.credential.${entry.credentialState}`) : "—"}
                      </span>
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
      </>}
  </section>;
}
