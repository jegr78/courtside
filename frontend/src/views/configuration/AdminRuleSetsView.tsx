import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import {
  api,
  type ClubConfig,
  type MembershipType,
  type RuleDefinition,
  type RuleSet,
  type RuleType,
  type RuleTypeConfiguration
} from "../../api/client";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { LoadFailure } from "../../components/LoadFailure";
import { SuccessFeedback } from "../../components/SuccessFeedback";
import { TextField } from "../../components/TextField";
import { useReportedFailure } from "../../failures/useReportedFailure";
import { useRetry } from "../../failures/useRetry";
import { formString } from "../../forms/formString";
import { useFragmentTarget } from "../../navigation/useFragmentTarget";
import { differs } from "../../unsaved/differs";
import { describedByMark } from "../../unsaved/markId";
import { UnsavedChangesQuestion } from "../../unsaved/UnsavedChangesQuestion";
import { UnsavedMark } from "../../unsaved/UnsavedMark";
import { useUnsavedForm } from "../../unsaved/useUnsavedForm";
import { useClubConfigForm } from "./clubConfigForm";

const RULE_SET_NAME_LENGTH = 60;

export function AdminRuleSetsView({ configurationChanged }: { configurationChanged: (config: ClubConfig) => void }) {
  const { t } = useTranslation();
  const { message: error, report, clear } = useReportedFailure();
  const newRuleSet = useUnsavedForm("rule-set:new");
  const { config, saved, unsaved: unsavedFallback, loaded, applied, change } = useClubConfigForm(configurationChanged);
  const [fallbackPending, setFallbackPending] = useState(false);
  const [pendingRuleSetId, setPendingRuleSetId] = useState<string>();
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  const [ruleTypes, setRuleTypes] = useState<RuleTypeConfiguration[]>([]);
  const [selectedRuleSetId, setSelectedRuleSetId] = useState("");
  const selectedRuleSetIdRef = useRef("");
  const [loadedRuleSetId, setLoadedRuleSetId] = useState<string>();
  const [rules, setRules] = useState<RuleDefinition[]>([]);
  const [membershipTypes, setMembershipTypes] = useState<MembershipType[]>([]);
  const [ruleSetName, setRuleSetName] = useState("");
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState<string>();
  const [loadAttempt, retryLoad] = useRetry();
  const [search] = useSearchParams();
  const requestedRuleSetId = useRef(search.get("ruleSetId"));
  useFragmentTarget("rule-set", selectedRuleSetId !== "");

  useEffect(() => {
    let active = true;
    void Promise.all([api.adminConfig(), api.ruleSets(), api.ruleTypes(), api.membershipTypes()])
      .then(([loadedConfig, loadedRuleSets, loadedRuleTypes, loadedMembershipTypes]) => {
        if (!active) return;
        loaded(loadedConfig);
        setRuleSets(loadedRuleSets);
        setRuleTypes(loadedRuleTypes);
        setMembershipTypes(loadedMembershipTypes);
        if (selectedRuleSetIdRef.current === "") {
          const initial = loadedRuleSets.find((ruleSet) => ruleSet.id === requestedRuleSetId.current) ?? loadedRuleSets[0];
          selectRuleSet(initial?.id ?? "");
          setRuleSetName(initial?.name ?? "");
        }
      })
      .catch((failure) => {
        if (active) report(failure);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, loaded, report]);

  useEffect(() => {
    setRules([]);
    setLoadedRuleSetId(undefined);
    if (!selectedRuleSetId) {
      return;
    }
    let active = true;
    void api.rules(selectedRuleSetId)
      .then((loadedRules) => {
        if (active) {
          setRules(loadedRules);
          setLoadedRuleSetId(selectedRuleSetId);
        }
      })
      .catch((failure) => {
        if (active) report(failure);
      });
    return () => {
      active = false;
    };
  }, [report, selectedRuleSetId]);

  async function addRuleSet(formElement: HTMLFormElement) {
    const name = formString(new FormData(formElement), "name");
    if (await mutateRuleSet(() => api.createRuleSet({ name }))) formElement.reset();
  }

  // A set that went inactive after it was chosen stays on the list: dropping it would clear the
  // club's own choice the next time anybody saves this form.
  const assignableRuleSets = ruleSets.filter((ruleSet) =>
    ruleSet.active || ruleSet.id === config?.noMembershipTypeRuleSetId);

  const selectedRuleSet = ruleSets.find((ruleSet) => ruleSet.id === selectedRuleSetId);
  const unsavedRuleSetName = Boolean(selectedRuleSet) && ruleSetName !== selectedRuleSet?.name;
  // Retiring a rule set does not stop it binding: the rule query joins on rule_set_id without
  // reading active, so what it prevents is a new membership type pointing at it.
  const boundTypes = (ruleSetId: string) => membershipTypes.filter((type) => type.ruleSetId === ruleSetId);

  function selectRuleSet(ruleSetId: string) {
    selectedRuleSetIdRef.current = ruleSetId;
    setSelectedRuleSetId(ruleSetId);
  }

  function chooseRuleSet(ruleSetId: string) {
    selectRuleSet(ruleSetId);
    setRuleSetName(ruleSets.find((ruleSet) => ruleSet.id === ruleSetId)?.name ?? "");
  }

  // Switching the selection is how this surface leaves an editor, and it loses the typed name the
  // way navigating away would, so it asks the same question rather than dropping the edit.
  function askBeforeChoosing(ruleSetId: string) {
    if (ruleSetId === selectedRuleSetId) return;
    if (unsavedRuleSetName) setPendingRuleSetId(ruleSetId); else chooseRuleSet(ruleSetId);
  }

  async function applyRuleSetChange(change: () => Promise<void>): Promise<boolean> {
    if (pending) return false;
    setPending(true);
    try {
      await change();
      clear();
      setSuccess(t("admin.rules.ruleSetSaved"));
      return true;
    } catch (failure) {
      setSuccess(undefined);
      report(failure);
      return false;
    } finally {
      setPending(false);
    }
  }

  function mutateRuleSet(change: () => Promise<RuleSet>): Promise<boolean> {
    return applyRuleSetChange(async () => {
      const written = await change();
      setRuleSets((current) => current.some((ruleSet) => ruleSet.id === written.id)
        ? current.map((ruleSet) => ruleSet.id === written.id ? written : ruleSet)
        : [...current, written]);
      selectRuleSet(written.id);
      setRuleSetName(written.name);
    });
  }

  function toggleRuleSet(ruleSet: RuleSet): Promise<boolean> {
    return applyRuleSetChange(async () => {
      // Retiring a rule set is not a save, so it answers for `active` and for nothing else
      const { active } = await api.setRuleSetActive(ruleSet.id, !ruleSet.active);
      setRuleSets((current) => current.map((item) => item.id === ruleSet.id ? { ...item, active } : item));
    });
  }

  async function removeRule(ruleType: RuleType) {
    if (pending || !selectedRuleSetId) return;
    setPending(true);
    try {
      await api.removeRule(selectedRuleSetId, ruleType);
      setRules((current) => current.filter((rule) => rule.ruleType !== ruleType));
      clear();
      setSuccess(t("admin.rules.saved"));
    } catch (failure) {
      setSuccess(undefined);
      report(failure);
    } finally {
      setPending(false);
    }
  }

  async function saveFallback(event: FormEvent) {
    event.preventDefault();
    if (!config || fallbackPending) return;
    setFallbackPending(true);
    clear();
    setSuccess(undefined);
    try {
      applied(await api.changeAdminConfig(config));
      setSuccess(t("admin.ruleSets.fallbackSaved"));
    } catch (failure) {
      report(failure);
    } finally {
      setFallbackPending(false);
    }
  }

  async function saveRule(ruleType: RuleType, params: Record<string, number>) {
    const ruleSetId = selectedRuleSetId;
    if (!ruleSetId || loadedRuleSetId !== ruleSetId) return;
    clear();
    setSuccess(undefined);
    try {
      const changed = await api.setRule(ruleSetId, ruleType, params);
      if (selectedRuleSetIdRef.current === ruleSetId) {
        setRules((current) => [...current.filter((rule) => rule.ruleType !== ruleType), changed]);
        setSuccess(t("admin.rules.saved"));
      }
    } catch (failure) {
      if (selectedRuleSetIdRef.current === ruleSetId) report(failure);
    }
  }

  const cell = "grid min-w-0 grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-3 md:table-cell md:border-t md:p-2 md:align-middle";
  const cellLabel = "font-medium md:hidden";

  return <section data-testid="admin-rule-sets-view" className="surface-panel min-w-0 grid gap-8 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:min-w-0 [&>*]:max-w-5xl sm:p-8">
    <h1 className="text-3xl font-bold">{t("admin.rules.title")}</h1>
    {!config
      ? (error ? <LoadFailure message={error} retry={() => { clear(); retryLoad(); }} /> : <p role="status">{t("status.loading")}</p>)
      : <>
        {error && <Alert testId="admin-error">{error}</Alert>}
        {success && <SuccessFeedback testId="admin-save-success">{success}</SuccessFeedback>}
        <div data-testid="booking-rules" className="grid gap-8">
          <div className="grid gap-4">
            <h2 id="rule-set-overview-heading" className="text-2xl font-bold">{t("admin.ruleSets.overview")}</h2>
            <table data-testid="rule-set-overview" aria-labelledby="rule-set-overview-heading" className="w-full border-collapse text-left">
              <thead className="sr-only md:not-sr-only">
                <tr className="text-muted text-sm">
                  <th scope="col" className="p-2 font-semibold">{t("admin.rules.ruleSet")}</th>
                  <th scope="col" className="p-2 font-semibold">{t("admin.ruleSets.state")}</th>
                  <th scope="col" className="p-2 font-semibold">{t("admin.ruleSets.appliesTo")}</th>
                </tr>
              </thead>
              <tbody className="grid gap-3 md:table-row-group">
                {ruleSets.map((ruleSet) => {
                  const types = boundTypes(ruleSet.id).map((type) => type.name);
                  const fallback = saved?.noMembershipTypeRuleSetId === ruleSet.id;
                  return <tr key={ruleSet.id} className="grid gap-2 rounded-xl border p-4 md:table-row md:rounded-none md:border-0 md:p-0">
                    <th scope="row" className={`${cell} font-normal`}>
                      <span aria-hidden="true" className={cellLabel}>{t("admin.rules.ruleSet")}</span>
                      <button type="button" data-testid={`rule-set-choose-${ruleSet.id}`} aria-pressed={ruleSet.id === selectedRuleSetId}
                              onClick={() => askBeforeChoosing(ruleSet.id)}
                              className="focus-ring justify-self-start rounded-lg px-2 py-1 text-left font-semibold break-words underline underline-offset-4 aria-pressed:bg-(--cs-raised) aria-pressed:no-underline">
                        {ruleSet.name}
                      </button>
                    </th>
                    <td className={cell}>
                      <span aria-hidden="true" className={cellLabel}>{t("admin.ruleSets.state")}</span>
                      <span data-testid={`rule-set-state-${ruleSet.id}`} className={ruleSet.active ? "text-muted" : "font-semibold"}>
                        {t(ruleSet.active ? "admin.ruleSets.active" : "admin.ruleSets.retired")}
                      </span>
                    </td>
                    <td className={cell}>
                      <span aria-hidden="true" className={cellLabel}>{t("admin.ruleSets.appliesTo")}</span>
                      <span data-testid={`rule-set-applies-${ruleSet.id}`} className="min-w-0 break-words">
                        {types.length === 0 && !fallback
                          ? <span className="text-muted">{t("admin.ruleSets.appliesToNobody")}</span>
                          : [...types, ...(fallback ? [t("admin.ruleSets.withoutMembershipType")] : [])].join(", ")}
                      </span>
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
            <div className="grid gap-5 md:grid-cols-2 md:items-start">
              <form noValidate {...newRuleSet.form} onSubmit={(event) => { event.preventDefault(); void addRuleSet(event.currentTarget); }} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <TextField data-testid="new-rule-set-name" disabled={pending} name="name" maxLength={RULE_SET_NAME_LENGTH} label={t("admin.rules.newRuleSet")} />
                <Button variant="primary" data-testid="create-rule-set" disabled={pending} type="submit">{t("admin.create")}</Button>
              </form>
              <form noValidate onSubmit={(event) => void saveFallback(event)} className="grid gap-3 rounded-xl border p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <label className="grid gap-2 font-medium">
                    {t("admin.config.noMembershipTypeRuleSet")}
                    <select data-testid="no-membership-type-rule-set" className="form-control min-w-0 rounded-lg border px-3 py-3"
                            value={config.noMembershipTypeRuleSetId ?? ""}
                            onChange={(event) => change({ noMembershipTypeRuleSetId: event.target.value || null })}>
                      <option value="">{t("admin.config.noMembershipTypeRuleSetNone")}</option>
                      {assignableRuleSets.map((ruleSet) => <option key={ruleSet.id} value={ruleSet.id}>{ruleSet.name}</option>)}
                    </select>
                  </label>
                  <Button variant="primary" data-testid="save-no-membership-type-rule-set" type="submit"
                          aria-describedby={describedByMark("rule-set-fallback", unsavedFallback)}
                          disabled={fallbackPending}>{t("admin.save")}</Button>
                </div>
                <UnsavedMark id="rule-set-fallback" unsaved={unsavedFallback} />
                <p className="text-muted text-sm">{t("admin.config.noMembershipTypeRuleSetHelp")}</p>
              </form>
            </div>
          </div>
          <section id="rule-set" data-testid="rule-set-editor" tabIndex={-1} aria-labelledby="rule-set-editor-heading" className="grid gap-5">
            <h2 id="rule-set-editor-heading" className="text-2xl font-bold">{t("admin.ruleSets.selected")}</h2>
            {selectedRuleSet && <div className="grid gap-3 rounded-xl border p-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
                <TextField data-testid="rule-set-name" disabled={pending} maxLength={RULE_SET_NAME_LENGTH} label={t("admin.rules.ruleSetName")} value={ruleSetName} onChange={(event) => setRuleSetName(event.target.value)} />
                <Button variant="primary" data-testid="save-rule-set" aria-describedby={describedByMark(`rule-set:${selectedRuleSet.id}`, unsavedRuleSetName)} disabled={pending} type="button" onClick={() => void mutateRuleSet(() => api.changeRuleSet(selectedRuleSet.id, { name: ruleSetName }))}>{t("admin.save")}</Button>
                <Button variant={selectedRuleSet.active ? "destructive" : "primary"} data-testid="toggle-rule-set" disabled={pending} type="button" onClick={() => void toggleRuleSet(selectedRuleSet)}>{t(selectedRuleSet.active ? "admin.deactivate" : "admin.activate")}</Button>
                <UnsavedMark id={`rule-set:${selectedRuleSet.id}`} unsaved={unsavedRuleSetName} />
              </div>
              <p data-testid="rule-set-retire-note" className="text-muted text-sm">
                {boundTypes(selectedRuleSet.id).length === 0
                  ? t("admin.rules.retireUnused")
                  : t("admin.rules.retireInUse", { types: boundTypes(selectedRuleSet.id).map((type) => type.name).join(", ") })}
              </p>
            </div>}
            {pendingRuleSetId !== undefined && <UnsavedChangesQuestion
              count={1}
              stay={() => setPendingRuleSetId(undefined)}
              discard={() => { chooseRuleSet(pendingRuleSetId); setPendingRuleSetId(undefined); }}
            />}
            <div data-testid="rule-set-rules" className="grid gap-4">
              <h3 data-testid="rule-set-rules-heading" className="text-xl font-bold">{t("admin.rules.ofRuleSet")}</h3>
              <div data-testid="rule-set-rules-list" className="grid gap-4 [&>*]:min-w-0 md:grid-cols-2">
                {ruleTypes.filter((type) => type.configurable).map((type) => <RuleEditor key={type.ruleType} type={type} definition={rules.find((rule) => rule.ruleType === type.ruleType)} disabled={loadedRuleSetId !== selectedRuleSetId} save={saveRule} remove={removeRule} />)}
              </div>
            </div>
            <div data-testid="club-wide-rules" className="grid gap-4">
              <div className="grid gap-1">
                <h3 data-testid="club-wide-rules-heading" className="text-xl font-bold">{t("admin.rules.clubWide")}</h3>
                <p data-testid="club-wide-rules-note" className="text-muted text-sm">{t("admin.rules.clubWideHelp")}</p>
              </div>
              <div data-testid="club-wide-rules-list" className="grid gap-4 [&>*]:min-w-0 md:grid-cols-2">
                {ruleTypes.filter((type) => !type.configurable).map((type) => <RuleEditor key={type.ruleType} type={type} definition={undefined} disabled save={saveRule} remove={removeRule} />)}
              </div>
            </div>
          </section>
        </div>
      </>}
  </section>;
}

function RuleEditor({ type, definition, disabled, save, remove }: { type: RuleTypeConfiguration; definition?: RuleDefinition; disabled: boolean; save: (ruleType: RuleType, params: Record<string, number>) => Promise<void>; remove: (ruleType: RuleType) => Promise<void> }) {
  const { t } = useTranslation();
  const [edited, setEdited] = useState<Record<string, number>>();
  const [read, setRead] = useState(definition);
  // Reading the definition through an effect instead would leave one render in which the editor
  // holds nothing and the rule holds values, and that render marks work nobody has done.
  if (read !== definition) {
    setRead(definition);
    setEdited(undefined);
  }
  const saved = definition?.params ?? {};
  const params = edited ?? saved;
  const mark = `rule:${type.ruleType}`;
  const unsaved = differs(params, saved);
  return <article className="grid content-start gap-4 rounded-xl border p-4">
    <div><h4 data-testid={`rule-${type.ruleType}-title`} className="text-lg font-bold">{t(`admin.rules.type.${type.ruleType}`)}</h4>{!type.configurable && <GlobalRuleLink ruleType={type.ruleType} />}</div>
    {type.configurable && <>
      {type.parameters.length === 0 && <p data-testid={`rule-${type.ruleType}-description`} className="text-muted text-sm">{t(`admin.rules.description.${type.ruleType}`, { defaultValue: "" })}</p>}
      {type.parameters.map((parameter) => <div key={parameter.name} className="grid gap-1">
        <TextField data-testid={`rule-${type.ruleType}-${parameter.name}`} disabled={disabled} type="number" className="max-w-40" label={t(`admin.rules.parameter.${parameter.name}`)} value={params[parameter.name] ?? ""} onChange={(event) => setEdited({ ...params, [parameter.name]: Number(event.target.value) })} />
        <p data-testid={`rule-${type.ruleType}-${parameter.name}-range`} className="text-muted text-sm">{t("admin.rules.range", { minimum: parameter.minimum, maximum: parameter.maximum })}</p>
      </div>)}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" data-testid={`save-rule-${type.ruleType}`} aria-describedby={describedByMark(mark, unsaved)} disabled={disabled} type="button" onClick={() => void save(type.ruleType, params)}>{t("admin.save")}</Button>
        {definition && <Button variant="destructive" data-testid={`remove-rule-${type.ruleType}`} disabled={disabled} type="button" onClick={() => void remove(type.ruleType)}>{t("admin.rules.remove")}</Button>}
        <UnsavedMark id={mark} unsaved={unsaved} />
      </div>
    </>}
  </article>;
}

function GlobalRuleLink({ ruleType }: { ruleType: RuleType }) {
  const { t } = useTranslation();
  const target = ruleType === "OPENING_HOURS" ? "/admin/facility/opening-hours"
    : ruleType === "SLOT_GRID" ? "/admin/configuration#slot-minutes"
      : undefined;
  if (!target) return null;
  return <Link data-testid={`rule-${ruleType}-global`} className="text-muted underline" to={target}>
    {t(`admin.rules.global.${ruleType}`)}
  </Link>;
}
