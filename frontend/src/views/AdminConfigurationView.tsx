import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
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
import { SuccessFeedback } from "../components/SuccessFeedback";
import { formString } from "../forms/formString";
import { useFragmentTarget } from "../navigation/useFragmentTarget";
import { differs } from "../unsaved/differs";
import { UnsavedChangesQuestion } from "../unsaved/UnsavedChangesQuestion";
import { describedByMark } from "../unsaved/markId";
import { UnsavedMark } from "../unsaved/UnsavedMark";
import { useUnsavedForm } from "../unsaved/useUnsavedForm";
import { brandContrast } from "../brandColor";

const RULE_SET_NAME_LENGTH = 60;
const MAX_LOGO_BYTES = 1024 * 1024;

function BrandColorField({ kind, label, value, changed }: {
  kind: "primary" | "accent";
  label: string;
  value: string;
  changed: (value: string) => void;
}) {
  const { t } = useTranslation();
  const contrast = brandContrast(value);
  const id = `${kind}-color`;
  return <fieldset className="min-w-0 grid gap-3 rounded-xl border p-4">
    <legend className="px-1 font-semibold">{label}</legend>
    <div className="grid grid-cols-[minmax(0,1fr)_4rem] items-end gap-3">
      <TextField id={`${id}-value`} data-testid={`${id}-value`} label={t("admin.config.colorHex")} value={value}
                 onChange={(event) => changed(event.target.value)} />
      <label className="grid gap-2 text-sm font-medium" htmlFor={`${id}-picker`}>
        {t("admin.config.colorPicker")}
        <input id={`${id}-picker`} data-testid={`${id}-picker`} type="color" value={contrast ? value : "#000000"}
               className="form-control h-12 w-full cursor-pointer rounded-lg border p-1"
               onChange={(event) => changed(event.target.value)} />
      </label>
    </div>
    {contrast && <>
      <button type="button" disabled data-testid={`${id}-preview`} className="rounded-lg px-4 py-3 font-semibold opacity-100"
              style={{ backgroundColor: value, color: contrast.textColor }}>
        {t("admin.config.colorPreview")}
      </button>
      <output data-testid={`${id}-contrast`} className={contrast.ratio >= 4.5 ? "text-sm" : "text-sm font-semibold text-amber-700 dark:text-amber-300"}>
        {t("admin.config.colorContrast", {
          ratio: contrast.ratio.toFixed(2),
          tone: t(contrast.tone === "dark" ? "admin.config.colorDarkText" : "admin.config.colorLightText"),
          result: t(contrast.ratio >= 4.5 ? "admin.config.colorContrastPass" : "admin.config.colorContrastWarning")
        })}
      </output>
    </>}
  </fieldset>;
}

// Named field by field so a request-only shape cannot pick up what the response adds to it.
function editable(loaded: AdminClubConfig): ClubConfigRequest {
  return {
    clubName: loaded.clubName,
    primaryColor: loaded.primaryColor,
    accentColor: loaded.accentColor,
    logoUrl: loaded.logoFallbackUrl,
    imprintUrl: loaded.imprintUrl,
    privacyUrl: loaded.privacyUrl,
    defaultLocale: loaded.defaultLocale,
    slotMinutes: loaded.slotMinutes,
    timeZone: loaded.timeZone,
    newAccountCredentialHours: loaded.newAccountCredentialHours,
    passwordResetCredentialHours: loaded.passwordResetCredentialHours,
    bookingReminderHours: loaded.bookingReminderHours,
    noMembershipTypeRuleSetId: loaded.noMembershipTypeRuleSetId ?? null
  };
}

function timeZones(current: string): string[] {
  const known = Intl.supportedValuesOf("timeZone");
  return known.includes(current) ? known : [current, ...known];
}

export function AdminConfigurationView({ configurationChanged }: { configurationChanged: (config: ClubConfig) => void }) {
  const { t } = useTranslation();
  const newRuleSet = useUnsavedForm("rule-set:new");
  const [pendingRuleSetId, setPendingRuleSetId] = useState<string>();
  const [config, setConfig] = useState<ClubConfigRequest>();
  const [saved, setSaved] = useState<ClubConfigRequest>();
  const [logo, setLogo] = useState<{ url?: string | null; uploaded: boolean }>();
  const [logoFile, setLogoFile] = useState<File>();
  const [configurationPending, setConfigurationPending] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
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
  useFragmentTarget("slot-minutes", config !== undefined);

  useEffect(() => {
    let active = true;
    void Promise.all([api.adminConfig(), api.ruleSets(), api.ruleTypes(), api.membershipTypes()])
      .then(([loadedConfig, loadedRuleSets, loadedRuleTypes, loadedMembershipTypes]) => {
        if (!active) return;
        setConfig((current) => current ?? editable(loadedConfig));
        setSaved((current) => current ?? editable(loadedConfig));
        setLogo((current) => current ?? { url: loadedConfig.logoUrl, uploaded: loadedConfig.logoUploaded });
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
    if (await mutateRuleSet(() => api.createRuleSet({ name }))) formElement.reset();
  }

  // A set that went inactive after it was chosen stays on the list: dropping it would clear the
  // club's own choice the next time anybody saves this form.
  const assignableRuleSets = ruleSets.filter((ruleSet) =>
    ruleSet.active || ruleSet.id === config?.noMembershipTypeRuleSetId);

  const selectedRuleSet = ruleSets.find((ruleSet) => ruleSet.id === selectedRuleSetId);
  const unsavedRuleSetName = Boolean(selectedRuleSet) && ruleSetName !== selectedRuleSet?.name;
  const unsavedConfiguration = differs(config, saved) || logoFile !== undefined;
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

  // Switching the selection is how this surface leaves an editor, and it loses the typed name the
  // way navigating away would, so it asks the same question rather than dropping the edit.
  function askBeforeChoosing(ruleSetId: string) {
    if (unsavedRuleSetName) setPendingRuleSetId(ruleSetId); else chooseRuleSet(ruleSetId);
  }

  async function applyRuleSetChange(change: () => Promise<void>): Promise<boolean> {
    if (pending) return false;
    setPending(true);
    try {
      await change();
      setError(undefined);
      setSuccess(t("admin.rules.ruleSetSaved"));
      return true;
    } catch (failure) {
      setSuccess(undefined);
      setError(problemMessage(failure, t));
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

  function selectLogoFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    setLogoFile(undefined);
    if (!selected) return;
    if (selected.size > MAX_LOGO_BYTES) {
      setError(t("config.logo.tooLarge"));
      event.target.value = "";
      return;
    }
    if (selected.type && selected.type !== "image/png" && selected.type !== "image/jpeg") {
      setError(t("config.logo.format"));
      event.target.value = "";
      return;
    }
    setError(undefined);
    setLogoFile(selected);
  }

  function applyConfiguration(changed: AdminClubConfig) {
    const written = editable(changed);
    setConfig(written);
    setSaved(written);
    setLogo({ url: changed.logoUrl, uploaded: changed.logoUploaded });
    configurationChanged(changed);
  }

  async function uploadLogo() {
    if (!logoFile || configurationPending) return;
    setConfigurationPending(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      const changed = await api.uploadClubLogo(logoFile);
      applyConfiguration(changed);
      setLogoFile(undefined);
      if (logoInput.current) logoInput.current.value = "";
      setSuccess(t("admin.config.logoUploaded"));
    } catch (failure) {
      setError(problemMessage(failure, t));
    } finally {
      setConfigurationPending(false);
    }
  }

  async function removeLogo() {
    if (configurationPending) return;
    setConfigurationPending(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      const changed = await api.deleteClubLogo();
      applyConfiguration(changed);
      setSuccess(t("admin.config.logoRemoved"));
    } catch (failure) {
      setError(problemMessage(failure, t));
    } finally {
      setConfigurationPending(false);
    }
  }

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    if (!config || configurationPending) return;
    setConfigurationPending(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      applyConfiguration(await api.changeAdminConfig(config));
      setSuccess(t("admin.config.saved"));
    } catch (failure) {
      setError(problemMessage(failure, t));
    } finally {
      setConfigurationPending(false);
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

  return <section data-testid="admin-configuration-view" className="surface-panel min-w-0 grid gap-8 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:min-w-0 [&>*]:max-w-5xl sm:p-8">
    <h1 className="text-3xl font-bold">{t("admin.config.title")}</h1>
    {!config
      ? (error ? <Alert testId="admin-error">{error}</Alert> : <p role="status">{t("status.loading")}</p>)
      : <>
        {error && <Alert testId="admin-error">{error}</Alert>}
        {success && <SuccessFeedback testId="admin-save-success">{success}</SuccessFeedback>}
        <form noValidate onSubmit={(event) => void saveConfig(event)} className="grid gap-5">
          <h2 className="text-2xl font-bold">{t("admin.config.club")}</h2>
          <TextField data-testid="club-name" label={t("admin.config.clubName")} value={config.clubName} onChange={(event) => changeConfig({ clubName: event.target.value })} />
          <div className="grid gap-5 [&>*]:min-w-0 sm:grid-cols-2">
            <BrandColorField kind="primary" label={t("admin.config.primaryColor")} value={config.primaryColor} changed={(primaryColor) => changeConfig({ primaryColor })} />
            <BrandColorField kind="accent" label={t("admin.config.accentColor")} value={config.accentColor} changed={(accentColor) => changeConfig({ accentColor })} />
            <fieldset className="min-w-0 grid gap-3 rounded-xl border p-4 sm:col-span-2">
              <legend className="px-1 font-semibold">{t("admin.config.logo")}</legend>
              {logo?.url && <img data-testid="logo-preview" src={logo.url} alt={t("admin.config.logoPreview")}
                                className="max-h-32 max-w-64 object-contain" />}
              <label className="grid gap-2 font-medium">
                {t("admin.config.logoFile")}
                <input ref={logoInput} data-testid="logo-file" type="file" accept="image/png,image/jpeg"
                       disabled={configurationPending} onChange={selectLogoFile}
                       className="form-control min-w-0 w-full rounded-lg border px-3 py-3" />
              </label>
              <p className="text-muted text-sm">{t("admin.config.logoHelp")}</p>
              <div className="flex flex-wrap gap-3">
                <Button data-testid="upload-logo" type="button" variant="secondary"
                        disabled={!logoFile || configurationPending} onClick={() => void uploadLogo()}>
                  {t("admin.config.logoUpload")}
                </Button>
                {logo?.uploaded && <Button data-testid="remove-logo" type="button" variant="destructive"
                                          disabled={configurationPending} onClick={() => void removeLogo()}>
                  {t("admin.config.logoRemove")}
                </Button>}
              </div>
              <TextField data-testid="logo-url" label={t("admin.config.logoUrl")} value={config.logoUrl ?? ""}
                         onChange={(event) => changeConfig({ logoUrl: event.target.value || null })} />
              <p className="text-muted text-sm">{t("admin.config.logoUrlHelp")}</p>
            </fieldset>
            <TextField data-testid="imprint-url" label={t("admin.config.imprintUrl")} value={config.imprintUrl ?? ""} onChange={(event) => changeConfig({ imprintUrl: event.target.value || null })} />
            <TextField data-testid="privacy-url" label={t("admin.config.privacyUrl")} value={config.privacyUrl ?? ""} onChange={(event) => changeConfig({ privacyUrl: event.target.value || null })} />
          </div>
          <label className="grid gap-2 font-medium">
            {t("admin.config.defaultLocale")}
            <LocaleSelect className="form-control rounded-lg border px-3 py-3" value={config.defaultLocale} supported={supported} changed={(defaultLocale) => changeConfig({ defaultLocale })} />
          </label>
          <TextField id="slot-minutes" data-testid="slot-minutes" type="number" min={5} max={120} step={5} label={t("admin.config.slotMinutes")} value={config.slotMinutes} onChange={(event) => changeConfig({ slotMinutes: Number(event.target.value) })} />
          <TextField data-testid="new-account-credential-hours" type="number" min={1} max={8760} label={t("admin.config.newAccountCredentialHours")} value={config.newAccountCredentialHours} onChange={(event) => changeConfig({ newAccountCredentialHours: Number(event.target.value) })} />
          <TextField data-testid="password-reset-credential-hours" type="number" min={1} max={8760} label={t("admin.config.passwordResetCredentialHours")} value={config.passwordResetCredentialHours} onChange={(event) => changeConfig({ passwordResetCredentialHours: Number(event.target.value) })} />
          <div className="grid gap-1">
            <TextField data-testid="booking-reminder-hours" type="number" min={0} max={168} label={t("admin.config.bookingReminderHours")} value={config.bookingReminderHours} onChange={(event) => changeConfig({ bookingReminderHours: Number(event.target.value) })} />
            <p className="text-muted text-sm">{t("admin.config.bookingReminderHoursHelp")}</p>
          </div>
          <div className="grid gap-1">
            <label className="grid gap-2 font-medium">
              {t("admin.config.noMembershipTypeRuleSet")}
              <select data-testid="no-membership-type-rule-set" className="form-control rounded-lg border px-3 py-3"
                      value={config.noMembershipTypeRuleSetId ?? ""}
                      onChange={(event) => changeConfig({ noMembershipTypeRuleSetId: event.target.value || null })}>
                <option value="">{t("admin.config.noMembershipTypeRuleSetNone")}</option>
                {assignableRuleSets.map((ruleSet) => <option key={ruleSet.id} value={ruleSet.id}>{ruleSet.name}</option>)}
              </select>
            </label>
            <p className="text-muted text-sm">{t("admin.config.noMembershipTypeRuleSetHelp")}</p>
          </div>
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
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" data-testid="save-club-config" type="submit"
                    aria-describedby={describedByMark("club-configuration", unsavedConfiguration)}
                    disabled={configurationPending}>{t("admin.save")}</Button>
            <UnsavedMark id="club-configuration" unsaved={unsavedConfiguration} />
          </div>
        </form>
        <div className="grid gap-5">
          <h2 className="text-2xl font-bold">{t("admin.rules.title")}</h2>
          <label className="grid gap-2 font-medium">
            {t("admin.rules.ruleSet")}
            <select data-testid="rule-set" className="form-control rounded-lg border px-3 py-3" value={selectedRuleSetId} onChange={(event) => askBeforeChoosing(event.target.value)}>
              {ruleSets.map((ruleSet) => <option key={ruleSet.id} value={ruleSet.id}>{ruleSet.name}</option>)}
            </select>
          </label>
          {selectedRuleSet && <div className="surface-subtle grid gap-3 rounded-xl border p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
              <TextField data-testid="rule-set-name" disabled={pending} maxLength={RULE_SET_NAME_LENGTH} label={t("admin.rules.ruleSetName")} value={ruleSetName} onChange={(event) => setRuleSetName(event.target.value)} />
              <Button variant="primary" data-testid="save-rule-set" aria-describedby={describedByMark(`rule-set:${selectedRuleSet.id}`, unsavedRuleSetName)} disabled={pending} type="button" onClick={() => void mutateRuleSet(() => api.changeRuleSet(selectedRuleSet.id, { name: ruleSetName }))}>{t("admin.save")}</Button>
              <Button variant={selectedRuleSet.active ? "destructive" : "primary"} data-testid="toggle-rule-set" disabled={pending} type="button" onClick={() => void toggleRuleSet(selectedRuleSet)}>{t(selectedRuleSet.active ? "admin.deactivate" : "admin.activate")}</Button>
              <UnsavedMark id={`rule-set:${selectedRuleSet.id}`} unsaved={unsavedRuleSetName} />
            </div>
            <p data-testid="rule-set-retire-note" className="text-muted text-sm">
              {boundTypes.length === 0
                ? t("admin.rules.retireUnused")
                : t("admin.rules.retireInUse", { types: boundTypes.map((type) => type.name).join(", ") })}
            </p>
          </div>}
          {pendingRuleSetId !== undefined && <UnsavedChangesQuestion
            count={1}
            stay={() => setPendingRuleSetId(undefined)}
            discard={() => { chooseRuleSet(pendingRuleSetId); setPendingRuleSetId(undefined); }}
          />}
          <form noValidate {...newRuleSet.form} onSubmit={(event) => { event.preventDefault(); void addRuleSet(event.currentTarget); }} className="surface-subtle grid gap-3 rounded-xl border p-4 md:grid-cols-[1fr_auto] md:items-end">
            <TextField data-testid="new-rule-set-name" disabled={pending} name="name" maxLength={RULE_SET_NAME_LENGTH} label={t("admin.rules.newRuleSet")} />
            <Button variant="primary" data-testid="create-rule-set" disabled={pending} type="submit">{t("admin.create")}</Button>
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
  return <article className="surface-subtle grid gap-4 rounded-xl border p-4">
    <div><h3 data-testid={`rule-${type.ruleType}-title`} className="text-lg font-bold">{t(`admin.rules.type.${type.ruleType}`)}</h3>{!type.configurable && <GlobalRuleLink ruleType={type.ruleType} />}</div>
    {type.configurable && <>
      {type.parameters.length === 0 && <p data-testid={`rule-${type.ruleType}-description`} className="text-muted text-sm">{t(`admin.rules.description.${type.ruleType}`, { defaultValue: "" })}</p>}
      {type.parameters.map((parameter) => <div key={parameter.name} className="grid gap-1">
        <TextField data-testid={`rule-${type.ruleType}-${parameter.name}`} disabled={disabled} type="number" label={t(`admin.rules.parameter.${parameter.name}`)} value={params[parameter.name] ?? ""} onChange={(event) => setEdited({ ...params, [parameter.name]: Number(event.target.value) })} />
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
