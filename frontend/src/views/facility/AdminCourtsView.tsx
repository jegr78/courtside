import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type AdminCourt } from "../../api/client";
import { Button } from "../../components/Button";
import { ImpactPanel } from "../../components/ImpactPanel";
import { TextField } from "../../components/TextField";
import { formString } from "../../forms/formString";
import { differs } from "../../unsaved/differs";
import { describedByMark } from "../../unsaved/markId";
import { UnsavedMark } from "../../unsaved/UnsavedMark";
import { useUnsavedForm } from "../../unsaved/useUnsavedForm";
import { FacilityPage } from "./FacilityPage";
import { useSaving } from "./useSaving";

export function AdminCourtsView() {
  const { t } = useTranslation();
  const [courts, setCourts] = useState<AdminCourt[]>();
  const [confirmed, setConfirmed] = useState<Record<string, AdminCourt>>({});
  const [timeZone, setTimeZone] = useState<string>();
  const { error, success, pending, reportError, save } = useSaving();
  const newCourt = useUnsavedForm("court:new");

  useEffect(() => {
    void Promise.all([api.adminCourts(), api.config()])
      .then(([loaded, configuration]) => {
        setCourts(loaded);
        setTimeZone(configuration.timeZone);
        setConfirmed(Object.fromEntries(loaded.map((court) => [court.id, court])));
      })
      .catch(reportError);
  }, [reportError]);

  // What the server last confirmed, kept beside what is on screen: a row is unsaved when the two
  // differ, so taking an edit back by hand leaves nothing to ask about.
  function confirm(changed: AdminCourt) {
    setCourts((current) => current?.some((item) => item.id === changed.id)
      ? current.map((item) => item.id === changed.id ? changed : item)
      : [...(current ?? []), changed]);
    setConfirmed((current) => ({ ...current, [changed.id]: changed }));
  }

  function edited(changed: AdminCourt) {
    setCourts((current) => current?.map((item) => item.id === changed.id ? changed : item));
  }

  function toggle(court: AdminCourt) {
    return save(`court:${court.id}`, async () =>
      confirm(await api.setAdminCourtActive(court.id, !court.active)));
  }

  function saveCourt(court: AdminCourt) {
    return save(`court:${court.id}`, async () =>
      confirm(await api.changeAdminCourt(court.id, { number: court.number, name: court.name ?? undefined })));
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    return save("court:new", async () => {
      confirm(await api.createAdminCourt({
        number: Number(formString(form, "number")), name: formString(form, "name") || undefined
      }));
      formElement.reset();
    });
  }

  return <FacilityPage testId="admin-courts-view" title={t("admin.facility.courts")} loaded={courts !== undefined && timeZone !== undefined} error={error} success={success}>
    <form noValidate {...newCourt.form} onSubmit={(event) => void create(event)} className="surface-subtle grid gap-3 rounded-xl border p-4 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
      <TextField data-testid="new-court-number" disabled={pending.has("court:new")} name="number" type="number" label={t("admin.facility.number")} />
      <TextField data-testid="new-court-name" disabled={pending.has("court:new")} name="name" label={t("admin.facility.name")} />
      <Button variant="primary" data-testid="create-court" disabled={pending.has("court:new")} type="submit">{t("admin.create")}</Button>
    </form>
    {courts && timeZone && courts.map((court) => <CourtEditor
      key={court.id}
      court={court}
      confirmed={confirmed[court.id]}
      timeZone={timeZone}
      disabled={pending.has(`court:${court.id}`)}
      changed={edited}
      save={saveCourt}
      toggle={toggle}
      reportError={reportError}
    />)}
  </FacilityPage>;
}

function CourtEditor({ court, confirmed, timeZone, disabled, changed, save, toggle, reportError }: { court: AdminCourt; confirmed?: AdminCourt; timeZone: string; disabled: boolean; changed: (court: AdminCourt) => void; save: (court: AdminCourt) => Promise<void>; toggle: (court: AdminCourt) => Promise<void>; reportError: (failure: unknown) => void }) {
  const { t } = useTranslation();
  const mark = `court:${court.id}`;
  const unsaved = differs(court, confirmed);
  return <article className="surface-subtle grid gap-3 rounded-xl border p-4 sm:grid-cols-[8rem_1fr_auto_auto_auto] sm:items-end">
    <TextField disabled={disabled} type="number" label={t("admin.facility.number")} value={court.number} onChange={(event) => changed({ ...court, number: Number(event.target.value) })} />
    <TextField disabled={disabled} data-testid={`court-name-${court.id}`} label={t("admin.facility.name")} value={court.name ?? ""} onChange={(event) => changed({ ...court, name: event.target.value || null })} />
    <Button variant="primary" disabled={disabled} data-testid={`save-court-${court.id}`} aria-describedby={describedByMark(mark, unsaved)} type="button" onClick={() => void save(court)}>{t("admin.save")}</Button>
    <Button variant={court.active ? "destructive" : "primary"} disabled={disabled} data-testid={`toggle-court-${court.id}`} type="button" onClick={() => void toggle(court)}>{t(court.active ? "admin.deactivate" : "admin.activate")}</Button>
    <UnsavedMark id={mark} unsaved={unsaved} />
    <div className="sm:col-span-full">
      <ImpactPanel kind="court" subject={court.id} timeZone={timeZone} ask={() => api.courtImpact(court.id)} reportError={reportError} />
    </div>
  </article>;
}
