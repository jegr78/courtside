import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  api,
  type AdminClubConfig,
  type ClubConfig,
  type ClubConfigRequest,
  type MembershipType,
  type RuleDefinition,
  type RuleSet,
  type RuleType,
  type RuleTypeConfiguration
} from "../api/client";
import { problemMessage } from "../api/problem-message";
import { LocaleSelect } from "../components/LocaleSelect";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { formString } from "../forms/formString";

const RULE_SET_NAME_LENGTH = 60;

// Named field by field so a request-only shape cannot pick up what the response adds to it.
function editable(loaded: AdminClubConfig): ClubConfigRequest {
  return {
    clubName: loaded.clubName,
    primaryColor: loaded.primaryColor,
    accentColor: loaded.accentColor,
    logoUrl: loaded.logoUrl,
    imprintUrl: loaded.imprintUrl,
    defaultLocale: loaded.defaultLocale,
    slotMinutes: loaded.slotMinutes,
    timeZone: loaded.timeZone,
    newAccountCredentialHours: loaded.newAccountCredentialHours,
    passwordResetCredentialHours: loaded.passwordResetCredentialHours
  };
}

function timeZones(current: string): string[] {
  const known = Intl.supportedValuesOf("timeZone");
  return known.includes(current) ? known : [current, ...known];
}

export function AdminConfigurationView({ configurationChanged }: { configurationChanged: (config: ClubConfig) => void }) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ClubConfigRequest>();
  const [supported, setSupported] = useState<string[]>();
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  const [ruleTypes, setRuleTypes] = useState<RuleTypeConfiguration[]>([]);
  const [selectedRuleSetId, setSelectedRuleSetId] = useState("");
  const selectedRuleSetIdRef = useRef("");
  const [loadedRuleSetId, setLoadedRuleSetId] = useState<string>();
  const [rules, setRules] = useState<RuleDefinition[]>([]);
  const [membershipTypes, setMembershipTypes] = useState<MembershipType[]>([]);
  const [ruleSetName, setRuleSetName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();

  useEffect(() => {
    let active = true;
    void Promise.all([api.adminConfig(), api.ruleSets(), api.ruleTypes(), api.membershipTypes()])
      .then(([loadedConfig, loadedRuleSets, loadedRuleTypes, loadedMembershipTypes]) => {
        if (!active) return;
        setConfig((current) => current ?? editable(loadedConfig));
        setSupported(loadedConfig.supportedLocales);
        setRuleSets(loadedRuleSets);
        setRuleTypes(loadedRuleTypes);
        setMembershipTypes(loadedMembershipTypes);
        selectRuleSet(loadedRuleSets[0]?.id ?? "");
        setRuleSetName(loadedRuleSets[0]?.name ?? "");
      })
      .catch((failure) => {
        if (active) setError(problemMessage(failure, t));
      });
    return () => {
      active = false;
    };
  }, [t]);

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
        if (active) setError(problemMessage(failure, t));
      });
    return () => {
      active = false;
    };
  }, [selectedRuleSetId, t]);

  async function addRuleSet(formElement: HTMLFormElement) {
    const name = formString(new FormData(formElement), "name");
    await mutateRuleSet(() => api.createRuleSet({ name }));
    formElement.reset();
  }

  const selectedRuleSet = ruleSets.find((ruleSet) => ruleSet.id === selectedRuleSetId);
  // Retiring a rule set does not stop it binding: the rule query joins on rule_set_id without
  // reading active, so what it prevents is a new membership type pointing at it.
  const boundTypes = membershipTypes.filter((type) => type.ruleSetId === selectedRuleSetId);

  function selectRuleSet(ruleSetId: string) {
    selectedRuleSetIdRef.current = ruleSetId;
    setSelectedRuleSetId(ruleSetId);
  }

  function chooseRuleSet(ruleSetId: string) {
    selectRuleSet(ruleSetId);
    setRuleSetName(ruleSets.find((ruleSet) => ruleSet.id === ruleSetId)?.name ?? "");
  }

  async function mutateRuleSet(change: () => Promise<RuleSet>) {
    if (pending) return;
    setPending(true);
    try {
      const written = await change();
      setRuleSets((current) => current.some((ruleSet) => ruleSet.id === written.id)
        ? current.map((ruleSet) => ruleSet.id === written.id ? written : ruleSet)
        : [...current, written]);
      selectRuleSet(written.id);
      setRuleSetName(written.name);
      setError(undefined);
      setSuccess(t("admin.rules.ruleSetSaved"));
    } catch (failure) {
      setSuccess(undefined);
      setError(problemMessage(failure, t));
    } finally {
      setPending(false);
    }
  }

  async function removeRule(ruleType: RuleType) {
    if (pending || !selectedRuleSetId) return;
    setPending(true);
    try {
      await api.removeRule(selectedRuleSetId, ruleType);
      setRules((current) => current.filter((rule) => rule.ruleType !== ruleType));
      setError(undefined);
      setSuccess(t("admin.rules.saved"));
    } catch (failure) {
      setSuccess(undefined);
      setError(problemMessage(failure, t));
    } finally {
      setPending(false);
    }
  }

  function changeConfig(changed: Partial<ClubConfigRequest>) {
    setConfig((current) => current ? { ...current, ...changed } : current);
  }

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    setError(undefined);
    setSuccess(undefined);
    try {
      const changed = await api.changeAdminConfig(config);
      setConfig(changed);
      configurationChanged(changed);
      setSuccess(t("admin.config.saved"));
    } catch (failure) {
      setError(problemMessage(failure, t));
    }
  }

  async function saveRule(ruleType: RuleType, params: Record<string, number>) {
    const ruleSetId = selectedRuleSetId;
    if (!ruleSetId || loadedRuleSetId !== ruleSetId) return;
    setError(undefined);
    setSuccess(undefined);
    try {
      const changed = await api.setRule(ruleSetId, ruleType, params);
      if (selectedRuleSetIdRef.current === ruleSetId) {
        setRules((current) => [...current.filter((rule) => rule.ruleType !== ruleType), changed]);
        setSuccess(t("admin.rules.saved"));
      }
    } catch (failure) {
      if (selectedRuleSetIdRef.current === ruleSetId) setError(problemMessage(failure, t));
    }
  }

  return <section data-testid="admin-configuration-view" className="surface-panel grid w-full max-w-5xl gap-8 self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-3xl font-bold">{t("admin.config.title")}</h1>
      <Link to="/" className="font-semibold underline">{t("nav.courts")}</Link>
    </div>
    {!config
      ? (error ? <Alert>{error}</Alert> : <p role="status">{t("status.loading")}</p>)
      : <>
        {error && <Alert>{error}</Alert>}
        {success && <div data-testid="admin-save-success"><Alert tone="success">{success}</Alert></div>}
        <form noValidate onSubmit={(event) => void saveConfig(event)} className="grid gap-5">
          <h2 className="text-2xl font-bold">{t("admin.config.club")}</h2>
          <TextField data-testid="club-name" label={t("admin.config.clubName")} value={config.clubName} onChange={(event) => changeConfig({ clubName: event.target.value })} />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField label={t("admin.config.primaryColor")} value={config.primaryColor} onChange={(event) => changeConfig({ primaryColor: event.target.value })} />
            <TextField label={t("admin.config.accentColor")} value={config.accentColor} onChange={(event) => changeConfig({ accentColor: event.target.value })} />
            <TextField data-testid="logo-url" label={t("admin.config.logoUrl")} value={config.logoUrl ?? ""} onChange={(event) => changeConfig({ logoUrl: event.target.value || null })} />
            <TextField data-testid="imprint-url" label={t("admin.config.imprintUrl")} value={config.imprintUrl ?? ""} onChange={(event) => changeConfig({ imprintUrl: event.target.value || null })} />
          </div>
          <label className="grid gap-2 font-medium">
            {t("admin.config.defaultLocale")}
            <LocaleSelect className="form-control rounded-lg border px-3 py-3" value={config.defaultLocale} supported={supported} changed={(defaultLocale) => changeConfig({ defaultLocale })} />
          </label>
          <TextField data-testid="slot-minutes" type="number" min={5} max={120} step={5} label={t("admin.config.slotMinutes")} value={config.slotMinutes} onChange={(event) => changeConfig({ slotMinutes: Number(event.target.value) })} />
          <TextField data-testid="new-account-credential-hours" type="number" min={1} max={8760} label={t("admin.config.newAccountCredentialHours")} value={config.newAccountCredentialHours} onChange={(event) => changeConfig({ newAccountCredentialHours: Number(event.target.value) })} />
          <TextField data-testid="password-reset-credential-hours" type="number" min={1} max={8760} label={t("admin.config.passwordResetCredentialHours")} value={config.passwordResetCredentialHours} onChange={(event) => changeConfig({ passwordResetCredentialHours: Number(event.target.value) })} />
          <div className="grid gap-1">
            <label className="grid gap-2 font-medium">
              {t("admin.config.timeZone")}
              <select data-testid="time-zone" className="form-control rounded-lg border px-3 py-3"
                      value={config.timeZone}
                      onChange={(event) => changeConfig({ timeZone: event.target.value })}>
                {timeZones(config.timeZone).map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
            </label>
            <p className="text-muted text-sm">{t("admin.config.timeZoneHelp")}</p>
          </div>
          <Button data-testid="save-club-config" className="justify-self-start" type="submit">{t("admin.save")}</Button>
        </form>
        <div className="grid gap-5">
          <h2 className="text-2xl font-bold">{t("admin.rules.title")}</h2>
          <label className="grid gap-2 font-medium">
            {t("admin.rules.ruleSet")}
            <select data-testid="rule-set" className="form-control rounded-lg border px-3 py-3" value={selectedRuleSetId} onChange={(event) => chooseRuleSet(event.target.value)}>
              {ruleSets.map((ruleSet) => <option key={ruleSet.id} value={ruleSet.id}>{ruleSet.name}</option>)}
            </select>
          </label>
          {selectedRuleSet && <div className="surface-subtle grid gap-3 rounded-xl border p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
              <TextField data-testid="rule-set-name" disabled={pending} maxLength={RULE_SET_NAME_LENGTH} label={t("admin.rules.ruleSetName")} value={ruleSetName} onChange={(event) => setRuleSetName(event.target.value)} />
              <Button data-testid="save-rule-set" disabled={pending} type="button" onClick={() => void mutateRuleSet(() => api.changeRuleSet(selectedRuleSet.id, { name: ruleSetName }))}>{t("admin.save")}</Button>
              <Button data-testid="toggle-rule-set" disabled={pending} type="button" onClick={() => void mutateRuleSet(() => api.setRuleSetActive(selectedRuleSet.id, !selectedRuleSet.active))}>{t(selectedRuleSet.active ? "admin.deactivate" : "admin.activate")}</Button>
            </div>
            <p data-testid="rule-set-retire-note" className="text-muted text-sm">
              {boundTypes.length === 0
                ? t("admin.rules.retireUnused")
                : t("admin.rules.retireInUse", { types: boundTypes.map((type) => type.name).join(", ") })}
            </p>
          </div>}
          <form noValidate onSubmit={(event) => { event.preventDefault(); void addRuleSet(event.currentTarget); }} className="surface-subtle grid gap-3 rounded-xl border p-4 md:grid-cols-[1fr_auto] md:items-end">
            <TextField data-testid="new-rule-set-name" disabled={pending} name="name" maxLength={RULE_SET_NAME_LENGTH} label={t("admin.rules.newRuleSet")} />
            <Button data-testid="create-rule-set" disabled={pending} type="submit">{t("admin.create")}</Button>
          </form>
          <div className="grid gap-4">
            {ruleTypes.map((type) => <RuleEditor key={type.ruleType} type={type} definition={rules.find((rule) => rule.ruleType === type.ruleType)} disabled={loadedRuleSetId !== selectedRuleSetId} save={saveRule} remove={removeRule} />)}
          </div>
        </div>
      </>}
  </section>;
}

function RuleEditor({ type, definition, disabled, save, remove }: { type: RuleTypeConfiguration; definition?: RuleDefinition; disabled: boolean; save: (ruleType: RuleType, params: Record<string, number>) => Promise<void>; remove: (ruleType: RuleType) => Promise<void> }) {
  const { t } = useTranslation();
  const [params, setParams] = useState<Record<string, number>>({});
  useEffect(() => setParams(definition?.params ?? {}), [definition]);
  return <article className="surface-subtle grid gap-4 rounded-xl border p-4">
    <div><h3 data-testid={`rule-${type.ruleType}-title`} className="text-lg font-bold">{t(`admin.rules.type.${type.ruleType}`)}</h3>{!type.configurable && <p data-testid={`rule-${type.ruleType}-global`} className="text-muted">{t("admin.rules.global")}</p>}</div>
    {type.configurable && <>
      {type.parameters.map((parameter) => <div key={parameter.name} className="grid gap-1">
        <TextField data-testid={`rule-${type.ruleType}-${parameter.name}`} disabled={disabled} type="number" label={t(`admin.rules.parameter.${parameter.name}`)} value={params[parameter.name] ?? ""} onChange={(event) => setParams({ ...params, [parameter.name]: Number(event.target.value) })} />
        <p data-testid={`rule-${type.ruleType}-${parameter.name}-range`} className="text-muted text-sm">{t("admin.rules.range", { minimum: parameter.minimum, maximum: parameter.maximum })}</p>
      </div>)}
      <div className="flex flex-wrap gap-3">
        <Button data-testid={`save-rule-${type.ruleType}`} disabled={disabled} type="button" onClick={() => void save(type.ruleType, params)}>{t("admin.save")}</Button>
        {definition && <Button data-testid={`remove-rule-${type.ruleType}`} disabled={disabled} type="button" onClick={() => void remove(type.ruleType)}>{t("admin.rules.remove")}</Button>}
      </div>
    </>}
  </article>;
}
