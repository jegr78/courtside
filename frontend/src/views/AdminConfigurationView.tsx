import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type AdminClubConfig, type ClubConfig } from "../api/client";
import { useReportedFailure } from "../failures/useReportedFailure";
import { LocaleSelect } from "../components/LocaleSelect";
import { Alert } from "../components/Alert";
import { LoadFailure } from "../components/LoadFailure";
import { useRetry } from "../failures/useRetry";
import { ContrastReading } from "../components/ContrastReading";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { useFragmentTarget } from "../navigation/useFragmentTarget";
import { describedByMark } from "../unsaved/markId";
import { UnsavedMark } from "../unsaved/UnsavedMark";
import { brandContrast } from "../brandColor";
import { ColorInput } from "../components/ColorInput";
import { useClubConfigForm } from "./configuration/clubConfigForm";

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
    <ColorInput id={id} valueTestId={`${id}-value`} pickerTestId={`${id}-picker`} value={value} changed={changed} />
    {contrast && <>
      <button type="button" disabled data-testid={`${id}-preview`} className="rounded-lg px-4 py-3 font-semibold opacity-100"
              style={{ backgroundColor: value, color: contrast.textColor }}>
        {t("admin.config.colorPreview")}
      </button>
      <ContrastReading contrast={contrast} testId={`${id}-contrast`} />
    </>}
  </fieldset>;
}

function timeZones(current: string): string[] {
  const known = Intl.supportedValuesOf("timeZone");
  return known.includes(current) ? known : [current, ...known];
}


export function AdminConfigurationView({ configurationChanged }: { configurationChanged: (config: ClubConfig) => void }) {
  const { t } = useTranslation();
  const { message: error, report, refuse, clear } = useReportedFailure();
  const { config, unsaved, loaded, applied, change: changeConfig } = useClubConfigForm(configurationChanged);
  const [logo, setLogo] = useState<{ url?: string | null; uploaded: boolean }>();
  const [logoFile, setLogoFile] = useState<File>();
  const [configurationPending, setConfigurationPending] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const [supported, setSupported] = useState<string[]>();
  const [success, setSuccess] = useState<string>();
  const [loadAttempt, retryLoad] = useRetry();
  useFragmentTarget("slot-minutes", config !== undefined);

  useEffect(() => {
    let active = true;
    void api.adminConfig()
      .then((loadedConfig) => {
        if (!active) return;
        loaded(loadedConfig);
        setLogo((current) => current ?? { url: loadedConfig.logoUrl, uploaded: loadedConfig.logoUploaded });
        setSupported(loadedConfig.supportedLocales);
      })
      .catch((failure) => {
        if (active) report(failure);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, loaded, report]);

  const unsavedConfiguration = unsaved || logoFile !== undefined;

  function selectLogoFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    setLogoFile(undefined);
    if (!selected) return;
    if (selected.size > MAX_LOGO_BYTES) {
      refuse(t("config.logo.tooLarge"));
      event.target.value = "";
      return;
    }
    if (selected.type && selected.type !== "image/png" && selected.type !== "image/jpeg") {
      refuse(t("config.logo.format"));
      event.target.value = "";
      return;
    }
    clear();
    setLogoFile(selected);
  }

  function applyConfiguration(changed: AdminClubConfig) {
    applied(changed);
    setLogo({ url: changed.logoUrl, uploaded: changed.logoUploaded });
  }

  async function uploadLogo() {
    if (!logoFile || configurationPending) return;
    setConfigurationPending(true);
    clear();
    setSuccess(undefined);
    try {
      const changed = await api.uploadClubLogo(logoFile);
      applyConfiguration(changed);
      setLogoFile(undefined);
      if (logoInput.current) logoInput.current.value = "";
      setSuccess(t("admin.config.logoUploaded"));
    } catch (failure) {
      report(failure);
    } finally {
      setConfigurationPending(false);
    }
  }

  async function removeLogo() {
    if (configurationPending) return;
    setConfigurationPending(true);
    clear();
    setSuccess(undefined);
    try {
      const changed = await api.deleteClubLogo();
      applyConfiguration(changed);
      setSuccess(t("admin.config.logoRemoved"));
    } catch (failure) {
      report(failure);
    } finally {
      setConfigurationPending(false);
    }
  }

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    if (!config || configurationPending) return;
    setConfigurationPending(true);
    clear();
    setSuccess(undefined);
    try {
      applyConfiguration(await api.changeAdminConfig(config));
      setSuccess(t("admin.config.saved"));
    } catch (failure) {
      report(failure);
    } finally {
      setConfigurationPending(false);
    }
  }

  return <section data-testid="admin-configuration-view" className="surface-panel min-w-0 grid gap-5 rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:min-w-0 [&>*]:max-w-5xl">
    <h1 className="text-3xl font-bold">{t("admin.config.title")}</h1>
    {!config
      ? (error ? <LoadFailure message={error} retry={() => { clear(); retryLoad(); }} /> : <p role="status">{t("status.loading")}</p>)
      : <>
        {error && <Alert testId="admin-error">{error}</Alert>}
        {success && <SuccessFeedback testId="admin-save-success">{success}</SuccessFeedback>}
        <form noValidate onSubmit={(event) => void saveConfig(event)} className="grid gap-4">
          <div data-testid="club-profile-columns" className="grid gap-5 [&>*]:min-w-0 lg:grid-cols-2 lg:items-start xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.25fr)]">
            <div data-testid="club-identity" className="grid gap-4">
              <TextField data-testid="club-name" label={t("admin.config.clubName")} value={config.clubName} onChange={(event) => changeConfig({ clubName: event.target.value })} />
              <div className="grid gap-1">
                <TextField data-testid="short-name" maxLength={12} label={t("admin.config.shortName")} value={config.shortName ?? ""} onChange={(event) => changeConfig({ shortName: event.target.value || null })} />
                <p className="text-muted text-sm">{t("admin.config.shortNameHelp")}</p>
              </div>
              <TextField data-testid="imprint-url" label={t("admin.config.imprintUrl")} value={config.imprintUrl ?? ""} onChange={(event) => changeConfig({ imprintUrl: event.target.value || null })} />
              <TextField data-testid="privacy-url" label={t("admin.config.privacyUrl")} value={config.privacyUrl ?? ""} onChange={(event) => changeConfig({ privacyUrl: event.target.value || null })} />
            </div>
            <div data-testid="club-settings" className="grid gap-4">
              <div className="grid gap-1">
                <TextField data-testid="documentation-url" label={t("admin.config.documentationUrl")} value={config.documentationUrl ?? ""} onChange={(event) => changeConfig({ documentationUrl: event.target.value || null })} />
                <p className="text-muted text-sm">{t("admin.config.documentationUrlHelp")}</p>
              </div>
              <label className="grid gap-2 font-medium">
                {t("admin.config.defaultLocale")}
                <LocaleSelect testId="default-locale" className="form-control rounded-lg border px-3 py-3" value={config.defaultLocale} supported={supported} changed={(defaultLocale) => changeConfig({ defaultLocale })} />
              </label>
              <div className="grid gap-1">
                <label className="grid gap-2 font-medium">
                  {t("admin.config.timeZone")}
                  <select data-testid="time-zone" className="form-control min-w-0 rounded-lg border px-3 py-3"
                          value={config.timeZone}
                          onChange={(event) => changeConfig({ timeZone: event.target.value })}>
                    {timeZones(config.timeZone).map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                  </select>
                </label>
                <p className="text-muted text-sm">{t("admin.config.timeZoneHelp")}</p>
              </div>
              <TextField id="slot-minutes" data-testid="slot-minutes" type="number" min={5} max={120} step={5} className="max-w-32" label={t("admin.config.slotMinutes")} value={config.slotMinutes} onChange={(event) => changeConfig({ slotMinutes: Number(event.target.value) })} />
            </div>
            <div data-testid="club-appearance" className="grid gap-4 [&>*]:min-w-0 sm:grid-cols-2 lg:col-span-2">
              <BrandColorField kind="primary" label={t("admin.config.primaryColor")} value={config.primaryColor} changed={(primaryColor) => changeConfig({ primaryColor })} />
              <BrandColorField kind="accent" label={t("admin.config.accentColor")} value={config.accentColor} changed={(accentColor) => changeConfig({ accentColor })} />
              <fieldset data-testid="club-logo" className="min-w-0 grid gap-2 rounded-xl border p-4 sm:col-span-2">
                <legend className="px-1 font-semibold">{t("admin.config.logo")}</legend>
                {logo?.url && <img data-testid="logo-preview" src={logo.url} alt={t("admin.config.logoPreview")}
                                  className="max-h-16 max-w-48 object-contain" />}
                <label className="grid gap-2 font-medium">
                  {t("admin.config.logoFile")}
                  <input ref={logoInput} data-testid="logo-file" type="file" accept="image/png,image/jpeg"
                         disabled={configurationPending} onChange={selectLogoFile}
                         className="form-control min-w-0 w-full rounded-lg border px-3 py-2" />
                </label>
                <p className="text-muted text-sm">{t("admin.config.logoHelp")}</p>
                <div data-testid="club-logo-actions" className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <TextField data-testid="logo-url" label={t("admin.config.logoUrl")} value={config.logoUrl ?? ""}
                             onChange={(event) => changeConfig({ logoUrl: event.target.value || null })} />
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
                </div>
                <p className="text-muted text-sm">{t("admin.config.logoUrlHelp")}</p>
              </fieldset>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" data-testid="save-club-config" type="submit"
                    aria-describedby={describedByMark("club-configuration", unsavedConfiguration)}
                    disabled={configurationPending}>{t("admin.save")}</Button>
            <UnsavedMark id="club-configuration" unsaved={unsavedConfiguration} />
          </div>
        </form>
      </>}
  </section>;
}
