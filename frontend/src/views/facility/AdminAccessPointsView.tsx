import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type AccessPoint, type AccessPointRequest, type AdminCourt, type ClubConfig, type ClubConfigRequest } from "../../api/client";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { formString } from "../../forms/formString";
import { SaveBar } from "../../unsaved/SaveBar";
import { useUnsavedForm } from "../../unsaved/useUnsavedForm";
import { ownedFields, useClubConfigForm } from "../configuration/clubConfigForm";
import { FacilityPage } from "./FacilityPage";
import { useSaving } from "./useSaving";

const MAX_NAME = 60;
const NEW = "access-point:new";
const SETTINGS = "access-settings";

function courtLabel(court: AdminCourt, t: (key: string, options?: Record<string, unknown>) => string) {
  return court.name ? `${t("court.number", { number: court.number })} · ${court.name}` : t("court.number", { number: court.number });
}

function requested(form: FormData): AccessPointRequest {
  const code = formString(form, "staticCode").trim();
  return {
    name: formString(form, "name").trim(),
    courtIds: form.getAll("courtIds").map(String),
    staticCode: code === "" ? null : code
  };
}

// A stored code keeps working after the club changes its length, so only a new one has to fit.
function acceptable(request: AccessPointRequest, digits: number, storedCode?: string | null): boolean {
  const code = request.staticCode;
  const codeFits = code === null || code === undefined || code === storedCode || (/^[0-9]+$/.test(code) && code.length === digits);
  return request.name !== "" && codeFits;
}

export function AdminAccessPointsView({ configurationChanged }: { configurationChanged: (config: ClubConfig) => void }) {
  const { t } = useTranslation();
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>();
  const [courts, setCourts] = useState<AdminCourt[]>();
  const [editing, setEditing] = useState<string>();
  const { error, success, pending, reportError, refuse, save } = useSaving();
  const settings = useClubConfigForm(configurationChanged, ownedFields.accessSettings);
  const { config: settingsConfig, loaded: settingsLoaded } = settings;
  const digits = settings.saved?.accessCodeLength;

  useEffect(() => {
    void Promise.all([api.adminAccessPoints(), api.adminCourts(), api.adminConfig()])
      .then(([points, allCourts, config]) => {
        setAccessPoints(points);
        setCourts(allCourts);
        settingsLoaded(config);
      })
      .catch(reportError);
  }, [reportError, settingsLoaded]);

  function replace(changed: AccessPoint) {
    setAccessPoints((current) => current?.map((item) => item.id === changed.id ? changed : item));
  }

  function submit(key: string, storedCode: string | null | undefined, send: (request: AccessPointRequest) => Promise<void>) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const request = requested(new FormData(event.currentTarget));
      if (!acceptable(request, digits ?? 6, storedCode)) {
        refuse(t("admin.facility.accessPointInvalid", { digits }));
        return;
      }
      void save(key, () => send(request));
    };
  }

  const create = (formElement: HTMLFormElement | null, saved: () => void) => submit(NEW, undefined, async (request) => {
    const created = await api.createAdminAccessPoint(request);
    setAccessPoints((current) => current && [...current, created]);
    formElement?.reset();
    saved();
  });

  function toggle(accessPoint: AccessPoint) {
    return save(`access-point:${accessPoint.id}:active`, async () => {
      replace(await api.setAdminAccessPointActive(accessPoint.id, !accessPoint.active));
    });
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settingsConfig) return;
    void save(SETTINGS, async () => settings.applied(await settings.save(settingsConfig)));
  }

  const loaded = accessPoints !== undefined && courts !== undefined && digits !== undefined && settingsConfig !== undefined;
  return <FacilityPage testId="admin-access-points-view" title={t("admin.facility.accessPoints")} error={error} success={success}>
    {loaded && <>
      <p className="text-muted">{t("admin.facility.accessPointsHint")}</p>
      <AccessSettingsForm config={settingsConfig} change={settings.change} unsaved={settings.unsaved}
                          pending={pending.has(SETTINGS)} discard={settings.discard} onSubmit={saveSettings} />
      <AccessPointForm id={NEW} heading={t("admin.facility.newAccessPoint")} courts={courts} digits={digits}
                       disabled={pending.has(NEW)} submitLabel={t("admin.create")} submitTestId="create-access-point"
                       onSubmit={create} />
      <section className="grid gap-3" aria-labelledby="all-access-points">
        <h2 id="all-access-points" className="text-2xl font-bold">{t("admin.facility.allAccessPoints")}</h2>
        {accessPoints.length === 0 && <p data-testid="no-access-points">{t("admin.facility.noAccessPoints")}</p>}
        <ul className="grid gap-3">
          {accessPoints.map((accessPoint) => <li key={accessPoint.id} data-testid={`access-point-${accessPoint.id}`} className="grid gap-3 rounded-xl border p-4">
            {editing === accessPoint.id
              ? <AccessPointForm id={`access-point:${accessPoint.id}`} heading={accessPoint.name} courts={courts} digits={digits}
                                 stored={accessPoint} disabled={pending.has(`access-point:${accessPoint.id}`)}
                                 submitLabel={t("admin.facility.accessPointSave")} submitTestId={`save-access-point-${accessPoint.id}`}
                                 cancel={() => setEditing(undefined)}
                                 onSubmit={(_, saved) => submit(`access-point:${accessPoint.id}`, accessPoint.staticCode, async (request) => {
                                   replace(await api.changeAdminAccessPoint(accessPoint.id, request));
                                   saved();
                                   setEditing(undefined);
                                 })} />
              : <AccessPointSummary accessPoint={accessPoint} courts={courts} edit={() => setEditing(accessPoint.id)} />}
            <span className="flex flex-wrap items-center gap-3">
              <span data-testid={`access-point-status-${accessPoint.id}`}>{t(accessPoint.active ? "admin.facility.statusActive" : "admin.facility.statusInactive")}</span>
              <Button variant={accessPoint.active ? "destructive" : "primary"} type="button" data-testid={`toggle-access-point-${accessPoint.id}`}
                      disabled={pending.has(`access-point:${accessPoint.id}:active`)} onClick={() => void toggle(accessPoint)}>
                {t(accessPoint.active ? "admin.deactivate" : "admin.activate")}
              </Button>
            </span>
          </li>)}
        </ul>
      </section>
    </>}
  </FacilityPage>;
}

function AccessSettingsForm({ config, change, unsaved, pending, discard, onSubmit }: {
  config: ClubConfigRequest;
  change: (changed: Partial<ClubConfigRequest>) => void;
  unsaved: boolean;
  pending: boolean;
  discard: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();
  return <form id="access-settings-form" noValidate onSubmit={onSubmit} aria-labelledby="access-settings" className="grid gap-4">
    <h2 id="access-settings" className="text-2xl font-bold">{t("admin.facility.accessSettings")}</h2>
    <div className="grid gap-5 [&>*]:min-w-0 md:grid-cols-3 md:items-start">
      <div className="grid gap-1">
        <TextField data-testid="access-lead-minutes" type="number" min={0} max={240} className="max-w-32" label={t("admin.config.accessLeadMinutes")} value={config.accessLeadMinutes ?? 15} onChange={(event) => change({ accessLeadMinutes: Number(event.target.value) })} />
        <p className="text-muted text-sm">{t("admin.config.accessLeadMinutesHelp")}</p>
      </div>
      <div className="grid gap-1">
        <TextField data-testid="access-lag-minutes" type="number" min={0} max={240} className="max-w-32" label={t("admin.config.accessLagMinutes")} value={config.accessLagMinutes ?? 15} onChange={(event) => change({ accessLagMinutes: Number(event.target.value) })} />
        <p className="text-muted text-sm">{t("admin.config.accessLagMinutesHelp")}</p>
      </div>
      <div className="grid gap-1">
        <TextField data-testid="access-code-length" type="number" min={4} max={8} className="max-w-32" label={t("admin.config.accessCodeLength")} value={config.accessCodeLength ?? 6} onChange={(event) => change({ accessCodeLength: Number(event.target.value) })} />
        <p className="text-muted text-sm">{t("admin.config.accessCodeLengthHelp")}</p>
      </div>
    </div>
    <SaveBar id={SETTINGS} subject={t("admin.facility.accessSettings")} saveTestId="save-access-settings" form="access-settings-form"
             unsaved={unsaved} pending={pending} discard={discard} />
  </form>;
}

function AccessPointSummary({ accessPoint, courts, edit }: { accessPoint: AccessPoint; courts: AdminCourt[]; edit: () => void }) {
  const { t } = useTranslation();
  const served = courts.filter((court) => accessPoint.courtIds.includes(court.id));
  return <div className="grid gap-1">
    <h3 className="font-bold" data-testid={`access-point-name-${accessPoint.id}`}>{accessPoint.name}</h3>
    <p data-testid={`access-point-courts-${accessPoint.id}`}>{served.map((court) => courtLabel(court, t)).join(", ")}</p>
    <p data-testid={`access-point-code-${accessPoint.id}`} className="font-mono">{accessPoint.staticCode ?? t("admin.facility.noCode")}</p>
    <Button variant="secondary" type="button" className="justify-self-start" data-testid={`edit-access-point-${accessPoint.id}`} onClick={edit}>
      {t("admin.facility.editAccessPoint")}
    </Button>
  </div>;
}

function AccessPointForm({ id, heading, courts, digits, stored, disabled, submitLabel, submitTestId, cancel, onSubmit }: {
  id: string;
  heading: string;
  courts: AdminCourt[];
  digits: number;
  stored?: AccessPoint;
  disabled: boolean;
  submitLabel: string;
  submitTestId: string;
  cancel?: () => void;
  onSubmit: (form: HTMLFormElement | null, saved: () => void) => (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();
  const unsaved = useUnsavedForm(id);
  const prefix = stored ? `access-point-${stored.id}` : "new-access-point";
  return <form noValidate {...unsaved.form} onSubmit={(event) => onSubmit(unsaved.form.ref.current, unsaved.saved)(event)}
               data-testid={`${prefix}-form`} className="grid gap-4 rounded-xl border p-4">
    <h2 className="font-bold">{heading}</h2>
    <TextField data-testid={`${prefix}-name`} name="name" maxLength={MAX_NAME} disabled={disabled}
               defaultValue={stored?.name} label={t("admin.facility.accessPointName")} />
    <fieldset className="grid gap-2">
      <legend className="font-medium">{t("admin.facility.accessPointCourts")}</legend>
      <div className="flex flex-wrap gap-4">
        {courts.map((court) => <label key={court.id} className="flex items-center gap-2">
          <input type="checkbox" name="courtIds" value={court.id} disabled={disabled}
                 data-testid={`${prefix}-court-${court.id}`} defaultChecked={stored?.courtIds.includes(court.id)} />
          {courtLabel(court, t)}
        </label>)}
      </div>
    </fieldset>
    <div className="grid gap-1">
      <TextField data-testid={`${prefix}-code`} name="staticCode" inputMode="numeric" autoComplete="off" disabled={disabled}
                 defaultValue={stored?.staticCode ?? ""} className="max-w-48 font-mono" label={t("admin.facility.staticCode")} />
      <p data-testid={`${prefix}-code-hint`} className="text-muted text-sm">{t("admin.facility.staticCodeHint", { digits })}</p>
    </div>
    <span className="flex flex-wrap gap-3">
      <Button variant="primary" type="submit" data-testid={submitTestId} disabled={disabled}>{submitLabel}</Button>
      {cancel && <Button variant="secondary" type="button" data-testid={`${prefix}-cancel`} onClick={() => { unsaved.saved(); cancel(); }}>
        {t("admin.facility.accessPointCancel")}
      </Button>}
    </span>
  </form>;
}
