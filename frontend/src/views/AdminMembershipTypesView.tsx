import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, type MembershipType, type MembershipTypeRequest, type RuleSet } from "../api/client";
import { useReportedFailure } from "../failures/useReportedFailure";
import { Alert } from "../components/Alert";
import { LoadFailure } from "../components/LoadFailure";
import { useRetry } from "../failures/useRetry";
import { Button } from "../components/Button";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { TextField } from "../components/TextField";
import { formString } from "../forms/formString";
import { differs } from "../unsaved/differs";
import { describedByMark } from "../unsaved/markId";
import { UnsavedMark } from "../unsaved/UnsavedMark";
import { useUnsavedForm } from "../unsaved/useUnsavedForm";

const NAME_LENGTH = 60;
const HOLDER_PAGE = 200;

interface Holders {
  count: number;
  more: boolean;
}

export function AdminMembershipTypesView() {
  const newType = useUnsavedForm("membership-type:new");
  const { t } = useTranslation();
  const { message: error, report, clear } = useReportedFailure();
  const [types, setTypes] = useState<MembershipType[]>();
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  const [holders, setHolders] = useState<Record<string, Holders>>({});
  const [success, setSuccess] = useState<string>();
  const [pending, setPending] = useState(false);
  const [loadAttempt, retryLoad] = useRetry();

  const reportError = useCallback((failure: unknown) => {
    setSuccess(undefined);
    report(failure);
  }, [report]);

  const countHolders = useCallback(async (membershipTypes: MembershipType[]) => {
    const counted = await Promise.all(membershipTypes.map(async (type) => {
      const page = await api.roster({ limit: HOLDER_PAGE, membershipTypeId: type.id });
      return [type.id, { count: page.entries.length, more: Boolean(page.nextCursor) }] as const;
    }));
    setHolders(Object.fromEntries(counted));
  }, []);

  useEffect(() => {
    void Promise.all([api.membershipTypes(), api.ruleSets()])
      .then(async ([membershipTypes, sets]) => {
        setTypes(membershipTypes);
        setRuleSets(sets);
        await countHolders(membershipTypes);
      })
      .catch(reportError);
  }, [countHolders, loadAttempt, reportError]);

  async function mutate(change: () => Promise<MembershipType>): Promise<boolean> {
    if (pending) return false;
    setPending(true);
    try {
      const changed = await change();
      setTypes((current) => {
        const known = current ?? [];
        return known.some((type) => type.id === changed.id)
          ? known.map((type) => type.id === changed.id ? changed : type)
          : [...known, changed];
      });
      clear();
      setSuccess(t("admin.membershipTypes.saved"));
      return true;
    } catch (failure) {
      reportError(failure);
      return false;
    } finally {
      setPending(false);
    }
  }

  async function saveType(id: string, request: MembershipTypeRequest) {
    await mutate(() => api.changeMembershipType(id, request));
  }

  async function toggleType(type: MembershipType) {
    await mutate(() => api.setMembershipTypeActive(type.id, !type.active));
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const formElement = event.currentTarget;
    const created = await mutate(() => api.createMembershipType({
      name: formString(form, "name"),
      ruleSetId: formString(form, "ruleSetId") || null,
      grantsAccount: form.get("grantsAccount") === "on"
    }));
    if (created) formElement.reset();
  }

  return <section data-testid="admin-membership-types-view" className="surface-panel grid gap-8 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:max-w-5xl sm:p-8">
    <h1 className="text-3xl font-bold">{t("admin.membershipTypes.title")}</h1>
    {!types
      ? (error ? <LoadFailure message={error} retry={() => { clear(); retryLoad(); }} /> : <p role="status">{t("status.loading")}</p>)
      : <>
        {error && <Alert>{error}</Alert>}
        {success && <SuccessFeedback testId="admin-save-success">{success}</SuccessFeedback>}
        <section className="grid gap-4">
          <div className="text-muted grid gap-1 text-sm">
            <p data-testid="membership-types-grants-account-note">{t("admin.membershipTypes.grantsAccountNote")}</p>
            <p data-testid="membership-types-retire-note">{t("admin.membershipTypes.retireNote")}</p>
          </div>
          {types.length === 0
            ? <p data-testid="membership-types-empty">{t("admin.membershipTypes.empty")}</p>
            : <table className="block w-full text-left md:table md:table-fixed">
              <colgroup>
                <col className="md:w-[26%]" />
                <col className="md:w-[27%]" />
                <col className="md:w-[10%]" />
                <col className="md:w-[9%]" />
                <col className="md:w-[28%]" />
              </colgroup>
              <thead className="sr-only md:not-sr-only">
                <tr>
                  <th scope="col" className="p-2">{t("admin.membershipTypes.name")}</th>
                  <th scope="col" className="p-2">{t("admin.membershipTypes.ruleSet")}</th>
                  <th scope="col" className="p-2">{t("admin.membershipTypes.grantsAccountColumn")}</th>
                  <th scope="col" className="p-2">{t("admin.membershipTypes.members")}</th>
                  <th scope="col" className="p-2"><span className="sr-only">{t("admin.membershipTypes.actions")}</span></th>
                </tr>
              </thead>
              <tbody className="grid gap-3 md:table-row-group">
                {types.map((type) => <MembershipTypeRow
                  key={type.id}
                  type={type}
                  ruleSets={ruleSets}
                  holders={holders[type.id]}
                  disabled={pending}
                  save={(request) => saveType(type.id, request)}
                  toggle={() => toggleType(type)}
                />)}
              </tbody>
            </table>}
        </section>
        <form noValidate {...newType.form} onSubmit={(event) => void create(event)} className="grid gap-3 rounded-xl border p-4">
          <h2 className="text-2xl font-bold">{t("admin.membershipTypes.newType")}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField data-testid="new-membership-type-name" disabled={pending} name="name" maxLength={NAME_LENGTH} label={t("admin.membershipTypes.name")} />
            <label className="grid gap-2 font-medium">
              {t("admin.membershipTypes.ruleSet")}
              <select data-testid="new-membership-type-rule-set" disabled={pending} name="ruleSetId" className="form-control rounded-lg border px-3 py-3" defaultValue="">
                <option value="">{t("admin.membershipTypes.noRuleSet")}</option>
                {ruleSets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 font-medium">
            <input data-testid="new-membership-type-grants-account" disabled={pending} name="grantsAccount" type="checkbox" className="size-5" />
            {t("admin.membershipTypes.grantsAccount")}
          </label>
          <Button variant="primary" data-testid="create-membership-type" disabled={pending} className="justify-self-start" type="submit">{t("admin.create")}</Button>
        </form>
      </>}
  </section>;
}

function holderCount(holders: Holders): string {
  return holders.more ? `${holders.count}+` : String(holders.count);
}

function MembershipTypeRow({ type, ruleSets, holders, disabled, save, toggle }: {
  type: MembershipType;
  ruleSets: RuleSet[];
  holders: Holders | undefined;
  disabled: boolean;
  save: (request: MembershipTypeRequest) => Promise<void>;
  toggle: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(type.name);
  const [ruleSetId, setRuleSetId] = useState(type.ruleSetId ?? "");
  const [grantsAccount, setGrantsAccount] = useState(type.grantsAccount);
  const mark = `membership-type:${type.id}`;
  const unsaved = differs(
    { name, ruleSetId: ruleSetId || null, grantsAccount },
    { name: type.name, ruleSetId: type.ruleSetId ?? null, grantsAccount: type.grantsAccount });
  const cell = "grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-center gap-3 md:table-cell md:border-t md:p-2 md:align-middle";
  const label = "font-medium md:hidden";

  return <tr data-testid={`membership-type-${type.id}`} className="grid gap-2 rounded-xl border p-4 md:table-row md:rounded-none md:border-0 md:bg-transparent md:p-0">
    <th scope="row" className={`${cell} font-normal`}>
      <span aria-hidden="true" data-testid="membership-type-label-name" className={label}>{t("admin.membershipTypes.name")}</span>
      <span className="flex min-w-0 items-center gap-2">
        <input data-testid={`membership-type-name-${type.id}`} aria-label={t("admin.membershipTypes.name")} disabled={disabled}
               maxLength={NAME_LENGTH} className="form-control w-0 min-w-24 flex-1 rounded-lg border px-3 py-1.5 font-semibold"
               value={name} onChange={(event) => setName(event.target.value)} />
        <span data-testid={`membership-type-state-${type.id}`} className={`shrink-0 text-sm ${type.active ? "text-muted" : "font-semibold"}`}>
          {t(type.active ? "admin.membershipTypes.offered" : "admin.membershipTypes.retired")}
        </span>
      </span>
    </th>
    <td className={cell}>
      <span aria-hidden="true" data-testid="membership-type-label-rule-set" className={label}>{t("admin.membershipTypes.ruleSet")}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <select data-testid={`membership-type-rule-set-${type.id}`} aria-label={t("admin.membershipTypes.ruleSet")} disabled={disabled}
                className="form-control w-0 min-w-28 flex-1 rounded-lg border px-3 py-1.5" value={ruleSetId} onChange={(event) => setRuleSetId(event.target.value)}>
          <option value="">{t("admin.membershipTypes.noRuleSet")}</option>
          {ruleSets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
        </select>
        {type.ruleSetId && <Link data-testid={`membership-type-rules-link-${type.id}`} className="inline-flex min-h-6 shrink-0 items-center text-xs whitespace-nowrap underline"
                                 to={`/admin/configuration?ruleSetId=${encodeURIComponent(type.ruleSetId)}#rule-set`}>
          {t("admin.membershipTypes.ruleSetLink")}
        </Link>}
      </span>
    </td>
    <td className={cell}>
      <span aria-hidden="true" data-testid="membership-type-label-grants-account" className={label}>{t("admin.membershipTypes.grantsAccount")}</span>
      <input data-testid={`membership-type-grants-account-${type.id}`} aria-label={t("admin.membershipTypes.grantsAccount")} disabled={disabled}
             type="checkbox" className="size-5" checked={grantsAccount} onChange={(event) => setGrantsAccount(event.target.checked)} />
    </td>
    <td className={cell}>
      <span aria-hidden="true" data-testid="membership-type-label-members" className={label}>{t("admin.membershipTypes.members")}</span>
      {holders
        ? <Link data-testid={`membership-type-holders-${type.id}`} className="font-semibold whitespace-nowrap underline" to={`/admin/roster?membershipTypeId=${type.id}`}
                aria-label={t("admin.membershipTypes.holders", { holders: holderCount(holders) })}>
          {holderCount(holders)}
        </Link>
        : <span data-testid={`membership-type-holders-${type.id}`} className="text-muted">
          <span aria-hidden="true">…</span><span className="sr-only">{t("status.loading")}</span>
        </span>}
    </td>
    <td className="min-w-0 md:border-t md:p-2 md:align-middle">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" data-testid={`save-membership-type-${type.id}`} aria-describedby={describedByMark(mark, unsaved)} disabled={disabled} type="button"
                className="px-3 py-1.5 text-sm" onClick={() => void save({ name, ruleSetId: ruleSetId || null, grantsAccount })}>{t("admin.save")}</Button>
        <Button variant={type.active ? "destructive" : "primary"} data-testid={`toggle-membership-type-${type.id}`} disabled={disabled} type="button"
                className="px-3 py-1.5 text-sm" onClick={() => void toggle()}>{t(type.active ? "admin.deactivate" : "admin.activate")}</Button>
        <UnsavedMark id={mark} unsaved={unsaved} />
      </div>
    </td>
  </tr>;
}
