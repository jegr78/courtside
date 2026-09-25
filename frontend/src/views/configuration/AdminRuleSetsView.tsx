import { useEffect, useRef, useState } from "react";
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
import { SaveBar } from "../../unsaved/SaveBar";
import { saveInTurn, type SaveStep } from "../../unsaved/saveInTurn";
import { UnsavedChangesQuestion } from "../../unsaved/UnsavedChangesQuestion";
import { useUnsavedForm } from "../../unsaved/useUnsavedForm";
import { ownedFields, useClubConfigForm } from "./clubConfigForm";

const RULE_SET_NAME_LENGTH = 60;
const MARK = "booking-rules";

type RuleEdit = { applies: boolean; params: Record<string, number> };

function storedRule(definition: RuleDefinition | undefined): RuleEdit {
  return { applies: definition !== undefined, params: definition?.params ?? {} };
}

export function AdminRuleSetsView({ configurationChanged }: { configurationChanged: (config: ClubConfig) => void }) {
  const { t } = useTranslation();
  const { message: error, report, clear } = useReportedFailure();
  const newRuleSet = useUnsavedForm("rule-set:new");
  const { config, saved, unsaved: unsavedFallback, loaded, applied, change, discard: discardFallback, save: sendFallback } = useClubConfigForm(configurationChanged, ownedFields.ruleSets);
  const [pendingRuleSetId, setPendingRuleSetId] = useState<string>();
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  const [ruleTypes, setRuleTypes] = useState<RuleTypeConfiguration[]>([]);
  const [selectedRuleSetId, setSelectedRuleSetId] = useState("");
  const selectedRuleSetIdRef = useRef("");
  const [loadedRuleSetId, setLoadedRuleSetId] = useState<string>();
  const [rules, setRules] = useState<RuleDefinition[]>([]);
  const [ruleEdits, setRuleEdits] = useState<Partial<Record<RuleType, RuleEdit>>>({});
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
    const created = await applyRuleSetChange(async () => {
      const written = await api.createRuleSet({ name });
      setRuleSets((current) => [...current, written]);
      return written;
    });
    if (created) {
      formElement.reset();
      askBeforeChoosing(created.id, created.name);
    }
  }

  // A set that went inactive after it was chosen stays on the list: dropping it would clear the
  // club's own choice the next time anybody saves this form.
  const assignableRuleSets = ruleSets.filter((ruleSet) =>
    ruleSet.active || ruleSet.id === config?.noMembershipTypeRuleSetId);

  const selectedRuleSet = ruleSets.find((ruleSet) => ruleSet.id === selectedRuleSetId);
  const unsavedRuleSetName = Boolean(selectedRuleSet) && ruleSetName !== selectedRuleSet?.name;
  const configurableTypes = ruleTypes.filter((type) => type.configurable);
  const definitionOf = (ruleType: RuleType) => rules.find((rule) => rule.ruleType === ruleType);
  const editedRules = configurableTypes.filter((type) => {
    const edit = ruleEdits[type.ruleType];
    return edit !== undefined && differs(edit, storedRule(definitionOf(type.ruleType)));
  });
  const unsavedSelection = unsavedRuleSetName || editedRules.length > 0;
  const unsaved = unsavedSelection || unsavedFallback;
  // Retiring a rule set does not stop it binding: the rule query joins on rule_set_id without
  // reading active, so what it prevents is a new membership type pointing at it.
  const boundTypes = (ruleSetId: string) => membershipTypes.filter((type) => type.ruleSetId === ruleSetId);

  function selectRuleSet(ruleSetId: string) {
    selectedRuleSetIdRef.current = ruleSetId;
    setSelectedRuleSetId(ruleSetId);
    setRuleEdits({});
  }

  function chooseRuleSet(ruleSetId: string, name = ruleSets.find((ruleSet) => ruleSet.id === ruleSetId)?.name) {
    selectRuleSet(ruleSetId);
    setRuleSetName(name ?? "");
  }

  // Switching the selection is how this surface leaves an editor, and it loses the typed name and
  // rules the way navigating away would, so it asks the same question rather than dropping them.
  function askBeforeChoosing(ruleSetId: string, name?: string) {
    if (ruleSetId === selectedRuleSetId) return;
    if (unsavedSelection) setPendingRuleSetId(ruleSetId); else chooseRuleSet(ruleSetId, name);
  }

  async function applyRuleSetChange<T>(change: () => Promise<T>): Promise<T | undefined> {
    if (pending) return undefined;
    setPending(true);
    try {
      const result = await change();
      clear();
      setSuccess(t("admin.rules.ruleSetSaved"));
      return result;
    } catch (failure) {
      setSuccess(undefined);
      report(failure);
      return undefined;
    } finally {
      setPending(false);
    }
  }

  function toggleRuleSet(ruleSet: RuleSet) {
    return applyRuleSetChange(async () => {
      // Retiring a rule set is not a save, so it answers for `active` and for nothing else
      const { active } = await api.setRuleSetActive(ruleSet.id, !ruleSet.active);
      setRuleSets((current) => current.map((item) => item.id === ruleSet.id ? { ...item, active } : item));
    });
  }

  function editRule(ruleType: RuleType, edit: RuleEdit) {
    setRuleEdits((current) => ({ ...current, [ruleType]: edit }));
  }

  function forgetRule(ruleType: RuleType) {
    setRuleEdits((current) => Object.fromEntries(Object.entries(current).filter(([type]) => type !== ruleType)));
  }

  function discard() {
    setRuleSetName(selectedRuleSet?.name ?? "");
    setRuleEdits({});
    discardFallback();
  }

  // One step per thing the page holds, in the order it is laid out; each applies its own answer so
  // a refusal leaves exactly the remainder unsaved.
  function steps(ruleSetId: string): SaveStep[] {
    const current = () => selectedRuleSetIdRef.current === ruleSetId;
    const name: SaveStep[] = unsavedRuleSetName ? [{
      subject: t("admin.rules.ruleSetName"),
      run: async () => {
        const written = await api.changeRuleSet(ruleSetId, { name: ruleSetName });
        setRuleSets((known) => known.map((ruleSet) => ruleSet.id === written.id ? written : ruleSet));
        if (current()) setRuleSetName(written.name);
      }
    }] : [];
    const ruleSteps = editedRules.map((type): SaveStep => ({
      subject: t(`admin.rules.type.${type.ruleType}`),
      run: async () => {
        const edit = ruleEdits[type.ruleType];
        if (!edit) return;
        if (edit.applies) {
          const written = await api.setRule(ruleSetId, type.ruleType, edit.params);
          if (current()) setRules((known) => [...known.filter((rule) => rule.ruleType !== type.ruleType), written]);
        } else {
          await api.removeRule(ruleSetId, type.ruleType);
          if (current()) setRules((known) => known.filter((rule) => rule.ruleType !== type.ruleType));
        }
        if (current()) forgetRule(type.ruleType);
      }
    }));
    const fallback: SaveStep[] = unsavedFallback && config ? [{
      subject: t("admin.config.noMembershipTypeRuleSet"),
      run: async () => applied(await sendFallback(config))
    }] : [];
    return [...name, ...ruleSteps, ...fallback];
  }

  async function savePage() {
    if (pending) return;
    setPending(true);
    clear();
    setSuccess(undefined);
    try {
      await saveInTurn(steps(selectedRuleSetId));
      setSuccess(t("admin.rules.pageSaved"));
    } catch (failure) {
      report(failure);
    } finally {
      setPending(false);
    }
  }

  const cell = "grid min-w-0 grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-3 md:table-cell md:border-t md:px-2 md:py-1 md:align-middle";
  const cellLabel = "font-medium md:hidden";

  return <section data-testid="admin-rule-sets-view" className="surface-panel min-w-0 grid gap-6 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:min-w-0 [&>*]:max-w-5xl">
    <h1 className="text-3xl font-bold">{t("admin.rules.title")}</h1>
    {!config
      ? (error ? <LoadFailure message={error} retry={() => { clear(); retryLoad(); }} /> : <p role="status">{t("status.loading")}</p>)
      : <>
        {error && <Alert testId="admin-error">{error}</Alert>}
        {success && <SuccessFeedback testId="admin-save-success">{success}</SuccessFeedback>}
        <div data-testid="booking-rules" className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] xl:items-start">
          <div className="grid gap-4">
            <h2 id="rule-set-overview-heading" className="text-2xl font-bold">{t("admin.ruleSets.overview")}</h2>
            <table data-testid="rule-set-overview" aria-labelledby="rule-set-overview-heading" className="w-full border-collapse text-left">
              <thead className="sr-only md:not-sr-only">
                <tr className="text-muted text-sm">
                  <th scope="col" className="px-2 py-1 font-semibold">{t("admin.rules.ruleSet")}</th>
                  <th scope="col" className="px-2 py-1 font-semibold">{t("admin.ruleSets.state")}</th>
                  <th scope="col" className="px-2 py-1 font-semibold">{t("admin.ruleSets.appliesTo")}</th>
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
                              disabled={pending} onClick={() => askBeforeChoosing(ruleSet.id)}
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
            <form noValidate {...newRuleSet.form} onSubmit={(event) => { event.preventDefault(); void addRuleSet(event.currentTarget); }} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <TextField data-testid="new-rule-set-name" disabled={pending} name="name" maxLength={RULE_SET_NAME_LENGTH} className="py-2" label={t("admin.rules.newRuleSet")} />
              <Button variant="primary" data-testid="create-rule-set" disabled={pending} type="submit" className="py-2">{t("admin.create")}</Button>
            </form>
            <div className="grid gap-2 rounded-xl border p-3">
              <label className="grid gap-2 font-medium">
                {t("admin.config.noMembershipTypeRuleSet")}
                <select data-testid="no-membership-type-rule-set" className="form-control min-w-0 rounded-lg border px-3 py-2"
                        disabled={pending} value={config.noMembershipTypeRuleSetId ?? ""}
                        onChange={(event) => change({ noMembershipTypeRuleSetId: event.target.value || null })}>
                  <option value="">{t("admin.config.noMembershipTypeRuleSetNone")}</option>
                  {assignableRuleSets.map((ruleSet) => <option key={ruleSet.id} value={ruleSet.id}>{ruleSet.name}</option>)}
                </select>
              </label>
              <p className="text-muted text-sm">{t("admin.config.noMembershipTypeRuleSetHelp")}</p>
            </div>
            <div data-testid="club-wide-rules" className="grid gap-2">
              <h3 data-testid="club-wide-rules-heading" className="text-xl font-bold">{t("admin.rules.clubWide")}</h3>
              <p data-testid="club-wide-rules-note" className="text-muted text-sm">{t("admin.rules.clubWideHelp")}</p>
              <ul data-testid="club-wide-rules-list" className="grid gap-1">
                {ruleTypes.filter((type) => !type.configurable).map((type) => <li key={type.ruleType} className="flex flex-wrap items-baseline gap-x-3">
                  <h4 data-testid={`rule-${type.ruleType}-title`} className="font-bold">{t(`admin.rules.type.${type.ruleType}`)}</h4>
                  <GlobalRuleLink ruleType={type.ruleType} />
                </li>)}
              </ul>
            </div>
          </div>
          <section id="rule-set" data-testid="rule-set-editor" tabIndex={-1} aria-labelledby="rule-set-editor-heading" className="grid gap-3">
            <h2 id="rule-set-editor-heading" className="text-2xl font-bold">{t("admin.ruleSets.selected")}</h2>
            {selectedRuleSet && <div className="grid gap-2">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <TextField data-testid="rule-set-name" disabled={pending} maxLength={RULE_SET_NAME_LENGTH} className="py-2" label={t("admin.rules.ruleSetName")} value={ruleSetName} onChange={(event) => setRuleSetName(event.target.value)} />
                <Button variant={selectedRuleSet.active ? "destructive" : "primary"} data-testid="toggle-rule-set" className="py-2" disabled={pending} type="button" onClick={() => void toggleRuleSet(selectedRuleSet)}>{t(selectedRuleSet.active ? "admin.deactivate" : "admin.activate")}</Button>
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
            <div data-testid="rule-set-rules" className="grid gap-2">
              <h3 data-testid="rule-set-rules-heading" className="text-xl font-bold">{t("admin.rules.ofRuleSet")}</h3>
              <div data-testid="rule-set-rules-list" className="grid [&>*]:min-w-0">
                {configurableTypes.map((type) => {
                  const stored = storedRule(definitionOf(type.ruleType));
                  return <RuleEditor key={type.ruleType} type={type} stored={stored} edit={ruleEdits[type.ruleType] ?? stored}
                                     disabled={pending || loadedRuleSetId !== selectedRuleSetId}
                                     changed={(edit) => editRule(type.ruleType, edit)} />;
                })}
              </div>
            </div>
          </section>
        </div>
        <SaveBar id={MARK} subject={t("admin.rules.title")} saveTestId="save-booking-rules"
                 unsaved={unsaved} pending={pending} save={() => void savePage()} discard={discard} />
      </>}
  </section>;
}

function RuleEditor({ type, stored, edit, disabled, changed }: { type: RuleTypeConfiguration; stored: RuleEdit; edit: RuleEdit; disabled: boolean; changed: (edit: RuleEdit) => void }) {
  const { t } = useTranslation();
  return <article className="grid gap-x-3 gap-y-1 border-t py-1.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
    <div className="grid min-w-0 gap-1">
      <h4 data-testid={`rule-${type.ruleType}-title`} className="font-bold">{t(`admin.rules.type.${type.ruleType}`)}</h4>
      {type.parameters.map((parameter) => <p key={parameter.name} className="text-sm">
        <label htmlFor={`rule-${type.ruleType}-${parameter.name}`}>{t(`admin.rules.parameter.${parameter.name}`)}</label>
        {" "}<span id={`rule-${type.ruleType}-${parameter.name}-range`} data-testid={`rule-${type.ruleType}-${parameter.name}-range`} className="text-muted whitespace-nowrap">
          {t("admin.rules.range", { minimum: parameter.minimum, maximum: parameter.maximum })}
        </span>
      </p>)}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      {type.parameters.map((parameter) => <input key={parameter.name} id={`rule-${type.ruleType}-${parameter.name}`} data-testid={`rule-${type.ruleType}-${parameter.name}`}
                                                 aria-describedby={`rule-${type.ruleType}-${parameter.name}-range`} disabled={disabled} type="number"
                                                 min={parameter.minimum} max={parameter.maximum}
                                                 className="form-control w-24 max-w-40 rounded-lg border px-3 py-1.5"
                                                 value={edit.params[parameter.name] ?? ""}
                                                 onChange={(event) => changed({ applies: true, params: { ...edit.params, [parameter.name]: Number(event.target.value) } })} />)}
      <label className="flex items-center gap-2 text-sm font-medium">
        <input data-testid={`rule-${type.ruleType}-applies`} type="checkbox" disabled={disabled} checked={edit.applies}
               onChange={(event) => changed(event.target.checked ? { applies: true, params: stored.params } : { applies: false, params: {} })} />
        {t("admin.rules.applies")}
      </label>
    </div>
    {type.parameters.length === 0 && <p data-testid={`rule-${type.ruleType}-description`} className="text-muted text-sm sm:col-span-2">{t(`admin.rules.description.${type.ruleType}`, { defaultValue: "" })}</p>}
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
