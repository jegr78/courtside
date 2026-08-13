import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  api,
  type ClubConfig,
  type ClubConfigRequest,
  type RuleDefinition,
  type RuleSet,
  type RuleType,
  type RuleTypeConfiguration
} from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";

function timeZones(current: string): string[] {
  const known = Intl.supportedValuesOf("timeZone");
  return known.includes(current) ? known : [current, ...known];
}

export function AdminConfigurationView({ configurationChanged }: { configurationChanged: (config: ClubConfig) => void }) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ClubConfigRequest>();
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  const [ruleTypes, setRuleTypes] = useState<RuleTypeConfiguration[]>([]);
  const [selectedRuleSetId, setSelectedRuleSetId] = useState("");
  const selectedRuleSetIdRef = useRef("");
  const [loadedRuleSetId, setLoadedRuleSetId] = useState<string>();
  const [rules, setRules] = useState<RuleDefinition[]>([]);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();

  useEffect(() => {
    void Promise.all([api.adminConfig(), api.ruleSets(), api.ruleTypes()])
      .then(([loadedConfig, loadedRuleSets, loadedRuleTypes]) => {
        setConfig(loadedConfig);
        setRuleSets(loadedRuleSets);
        setRuleTypes(loadedRuleTypes);
        selectRuleSet(loadedRuleSets[0]?.id ?? "");
      })
      .catch((failure) => setError(problemMessage(failure, t)));
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

  function selectRuleSet(ruleSetId: string) {
    selectedRuleSetIdRef.current = ruleSetId;
    setSelectedRuleSetId(ruleSetId);
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

  if (!config) return <p role="status">{t("status.loading")}</p>;

  return <section data-testid="admin-configuration-view" className="surface-panel grid w-full max-w-5xl gap-8 self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-3xl font-bold">{t("admin.config.title")}</h1>
      <Link to="/" className="font-semibold underline">{t("nav.courts")}</Link>
    </div>
    {error && <Alert>{error}</Alert>}
    {success && <div data-testid="admin-save-success"><Alert tone="success">{success}</Alert></div>}
    <form noValidate onSubmit={(event) => void saveConfig(event)} className="grid gap-5">
      <h2 className="text-2xl font-bold">{t("admin.config.club")}</h2>
      <TextField data-testid="club-name" label={t("admin.config.clubName")} value={config.clubName} onChange={(event) => setConfig({ ...config, clubName: event.target.value })} />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label={t("admin.config.primaryColor")} value={config.primaryColor} onChange={(event) => setConfig({ ...config, primaryColor: event.target.value })} />
        <TextField label={t("admin.config.accentColor")} value={config.accentColor} onChange={(event) => setConfig({ ...config, accentColor: event.target.value })} />
        <TextField label={t("admin.config.logoUrl")} value={config.logoUrl ?? ""} onChange={(event) => setConfig({ ...config, logoUrl: event.target.value || null })} />
        <TextField label={t("admin.config.imprintUrl")} value={config.imprintUrl ?? ""} onChange={(event) => setConfig({ ...config, imprintUrl: event.target.value || null })} />
      </div>
      <label className="grid gap-2 font-medium">
        {t("admin.config.defaultLocale")}
        <select className="form-control rounded-lg border px-3 py-3" value={config.defaultLocale} onChange={(event) => setConfig({ ...config, defaultLocale: event.target.value })}>
          <option value="de">Deutsch</option><option value="en">English</option>
        </select>
      </label>
      <TextField data-testid="slot-minutes" type="number" min={5} max={120} step={5} label={t("admin.config.slotMinutes")} value={config.slotMinutes} onChange={(event) => setConfig({ ...config, slotMinutes: Number(event.target.value) })} />
      <div className="grid gap-1">
        <label className="grid gap-2 font-medium">
          {t("admin.config.timeZone")}
          <select data-testid="time-zone" className="form-control rounded-lg border px-3 py-3"
                  value={config.timeZone}
                  onChange={(event) => setConfig({ ...config, timeZone: event.target.value })}>
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
        <select data-testid="rule-set" className="form-control rounded-lg border px-3 py-3" value={selectedRuleSetId} onChange={(event) => selectRuleSet(event.target.value)}>
          {ruleSets.map((ruleSet) => <option key={ruleSet.id} value={ruleSet.id}>{ruleSet.name}</option>)}
        </select>
      </label>
      <div className="grid gap-4">
        {ruleTypes.map((type) => <RuleEditor key={type.ruleType} type={type} definition={rules.find((rule) => rule.ruleType === type.ruleType)} disabled={loadedRuleSetId !== selectedRuleSetId} save={saveRule} />)}
      </div>
    </div>
  </section>;
}

function RuleEditor({ type, definition, disabled, save }: { type: RuleTypeConfiguration; definition?: RuleDefinition; disabled: boolean; save: (ruleType: RuleType, params: Record<string, number>) => Promise<void> }) {
  const { t } = useTranslation();
  const [params, setParams] = useState<Record<string, number>>({});
  useEffect(() => setParams(definition?.params ?? {}), [definition]);
  return <article className="surface-subtle grid gap-4 rounded-xl border p-4">
    <div><h3 className="text-lg font-bold">{t(`admin.rules.type.${type.ruleType}`)}</h3>{!type.configurable && <p data-testid={`rule-${type.ruleType}-global`} className="text-muted">{t("admin.rules.global")}</p>}</div>
    {type.configurable && <>
      {type.parameters.map((parameter) => <div key={parameter.name} className="grid gap-1">
        <TextField data-testid={`rule-${type.ruleType}-${parameter.name}`} disabled={disabled} type="number" label={t(`admin.rules.parameter.${parameter.name}`)} value={params[parameter.name] ?? ""} onChange={(event) => setParams({ ...params, [parameter.name]: Number(event.target.value) })} />
        <p data-testid={`rule-${type.ruleType}-${parameter.name}-range`} className="text-muted text-sm">{t("admin.rules.range", { minimum: parameter.minimum, maximum: parameter.maximum })}</p>
      </div>)}
      <Button data-testid={`save-rule-${type.ruleType}`} className="justify-self-start" disabled={disabled} type="button" onClick={() => void save(type.ruleType, params)}>{t("admin.save")}</Button>
    </>}
  </article>;
}
