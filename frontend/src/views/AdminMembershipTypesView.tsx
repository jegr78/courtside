import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, type MembershipType, type MembershipTypeRequest, type RuleSet } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
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
  const [types, setTypes] = useState<MembershipType[]>();
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  const [holders, setHolders] = useState<Record<string, Holders>>({});
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [pending, setPending] = useState(false);

  const reportError = useCallback((failure: unknown) => {
    setSuccess(undefined);
    setError(problemMessage(failure, t));
  }, [t]);

  const countHolders = useCallback(async (membershipTypes: MembershipType[]) => {
    const counted = await Promise.all(membershipTypes.map(async (type) => {
      const page = await api.roster(undefined, undefined, HOLDER_PAGE, type.id);
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
  }, [countHolders, reportError]);

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
      setError(undefined);
      setSuccess(t("admin.membershipTypes.saved"));
      return true;
    } catch (failure) {
      reportError(failure);
      return false;
    } finally {
      setPending(false);
    }
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
      ? (error ? <Alert>{error}</Alert> : <p role="status">{t("status.loading")}</p>)
      : <>
        {error && <Alert>{error}</Alert>}
        {success && <SuccessFeedback>{success}</SuccessFeedback>}
        <section className="grid gap-4">
          {types.length === 0 && <p data-testid="membership-types-empty">{t("admin.membershipTypes.empty")}</p>}
          {types.map((type) => <MembershipTypeCard
            key={type.id}
            type={type}
            ruleSets={ruleSets}
            holders={holders[type.id]}
            disabled={pending}
            save={(request) => mutate(() => api.changeMembershipType(type.id, request))}
            toggle={() => mutate(() => api.setMembershipTypeActive(type.id, !type.active))}
          />)}
        </section>
        <form noValidate {...newType.form} onSubmit={(event) => void create(event)} className="surface-subtle grid gap-3 rounded-xl border p-4">
          <h2 className="text-2xl font-bold">{t("admin.membershipTypes.newType")}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField data-testid="new-membership-type-name" disabled={pending} name="name" maxLength={NAME_LENGTH} label={t("admin.membershipTypes.name")} />
            <label className="grid gap-2 font-medium">
              {t("admin.membershipTypes.ruleSet")}
              <select data-testid="new-membership-type-rule-set" disabled={pending} name="ruleSetId" className="form-control rounded-lg border px-3 py-3 outline-none" defaultValue="">
                <option value="">{t("admin.membershipTypes.noRuleSet")}</option>
                {ruleSets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 font-medium">
            <input data-testid="new-membership-type-grants-account" disabled={pending} name="grantsAccount" type="checkbox" className="size-5" />
            {t("admin.membershipTypes.grantsAccount")}
          </label>
          <p className="text-muted text-sm">{t("admin.membershipTypes.grantsAccountNote")}</p>
          <Button variant="primary" data-testid="create-membership-type" disabled={pending} className="justify-self-start" type="submit">{t("admin.create")}</Button>
        </form>
      </>}
  </section>;
}

function MembershipTypeCard({ type, ruleSets, holders, disabled, save, toggle }: {
  type: MembershipType;
  ruleSets: RuleSet[];
  holders: Holders | undefined;
  disabled: boolean;
  save: (request: MembershipTypeRequest) => Promise<boolean>;
  toggle: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(type.name);
  const [ruleSetId, setRuleSetId] = useState(type.ruleSetId ?? "");
  const [grantsAccount, setGrantsAccount] = useState(type.grantsAccount);
  const mark = `membership-type:${type.id}`;
  const unsaved = differs(
    { name, ruleSetId: ruleSetId || null, grantsAccount },
    { name: type.name, ruleSetId: type.ruleSetId ?? null, grantsAccount: type.grantsAccount });

  return <article data-testid={`membership-type-${type.id}`} className="surface-subtle grid gap-3 rounded-xl border p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span data-testid={`membership-type-state-${type.id}`} className="font-medium">
        {t(type.active ? "admin.membershipTypes.offered" : "admin.membershipTypes.retired")}
      </span>
      <Link data-testid={`membership-type-holders-${type.id}`} className="font-semibold underline" to={`/admin/roster?membershipTypeId=${type.id}`}>
        {holders
          ? t("admin.membershipTypes.holders", { holders: holders.more ? `${holders.count}+` : String(holders.count) })
          : t("status.loading")}
      </Link>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <TextField data-testid={`membership-type-name-${type.id}`} disabled={disabled} maxLength={NAME_LENGTH} label={t("admin.membershipTypes.name")} value={name} onChange={(event) => setName(event.target.value)} />
      <label className="grid gap-2 font-medium">
        {t("admin.membershipTypes.ruleSet")}
        <select data-testid={`membership-type-rule-set-${type.id}`} disabled={disabled} className="form-control rounded-lg border px-3 py-3 outline-none" value={ruleSetId} onChange={(event) => setRuleSetId(event.target.value)}>
          <option value="">{t("admin.membershipTypes.noRuleSet")}</option>
          {ruleSets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
        </select>
      </label>
    </div>
    <label className="flex items-center gap-2 font-medium">
      <input data-testid={`membership-type-grants-account-${type.id}`} disabled={disabled} type="checkbox" className="size-5" checked={grantsAccount} onChange={(event) => setGrantsAccount(event.target.checked)} />
      {t("admin.membershipTypes.grantsAccount")}
    </label>
    <p className="text-muted text-sm">{t("admin.membershipTypes.grantsAccountNote")}</p>
    <Link data-testid={`membership-type-rules-link-${type.id}`} className="underline" to="/admin/configuration">{t("admin.membershipTypes.ruleSetLink")}</Link>
    <div className="grid gap-2 md:grid-cols-[auto_1fr] md:items-center">
      <Button variant="primary" data-testid={`save-membership-type-${type.id}`} aria-describedby={describedByMark(mark, unsaved)} disabled={disabled} type="button" onClick={() => void save({ name, ruleSetId: ruleSetId || null, grantsAccount })}>{t("admin.save")}</Button>
      <span><UnsavedMark id={mark} unsaved={unsaved} /></span>
      <Button variant={type.active ? "destructive" : "primary"} data-testid={`toggle-membership-type-${type.id}`} disabled={disabled} type="button" onClick={() => void toggle()}>{t(type.active ? "admin.deactivate" : "admin.activate")}</Button>
      {type.active && <p data-testid={`membership-type-retire-note-${type.id}`} className="text-muted text-sm">{t("admin.membershipTypes.retireNote")}</p>}
    </div>
  </article>;
}
