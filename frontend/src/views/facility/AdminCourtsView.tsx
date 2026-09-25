import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type AdminCourt } from "../../api/client";
import { useClubConfiguration } from "../../club/registry";
import { Button } from "../../components/Button";
import { ImpactPanel } from "../../components/ImpactPanel";
import { TextField } from "../../components/TextField";
import { formString } from "../../forms/formString";
import { differs } from "../../unsaved/differs";
import { SaveBar } from "../../unsaved/SaveBar";
import { saveInTurn } from "../../unsaved/saveInTurn";
import { useUnsavedForm } from "../../unsaved/useUnsavedForm";
import { FacilityPage } from "./FacilityPage";
import { useSaving } from "./useSaving";

const MIN_NUMBER = 1;
const MAX_NUMBER = 999;
const MAX_NAME = 60;
const MARK = "courts";
const FORM = "courts-form";

type CourtEntry = { number: string; name: string };

function stored(court: AdminCourt): CourtEntry {
  return { number: String(court.number), name: court.name ?? "" };
}

// Not parseInt: a number field accepts "1e3" and "3.9", which it would read as 1 and 3.
function validNumber(entry: string): boolean {
  const candidate = Number(entry);
  return entry.trim() !== "" && Number.isInteger(candidate) && candidate >= MIN_NUMBER && candidate <= MAX_NUMBER;
}

export function AdminCourtsView() {
  const { t } = useTranslation();
  const { club, error: clubError } = useClubConfiguration();
  const [courts, setCourts] = useState<AdminCourt[]>();
  const [entries, setEntries] = useState<Record<string, CourtEntry>>({});
  const [refused, setRefused] = useState<ReadonlySet<string>>(new Set());
  const { error, success, pending, reportError, refuse, save } = useSaving();
  const newCourt = useUnsavedForm("court:new");

  useEffect(() => {
    void api.adminCourts().then(setCourts).catch(reportError);
  }, [reportError]);

  const edited = (courts ?? []).filter((court) => court.id in entries && differs(entries[court.id], stored(court)));
  const saving = pending.has(MARK);

  function enter(court: AdminCourt, changed: Partial<CourtEntry>) {
    setEntries((current) => ({ ...current, [court.id]: { ...(current[court.id] ?? stored(court)), ...changed } }));
    setRefused((current) => {
      const next = new Set(current);
      next.delete(court.id);
      return next;
    });
  }

  function forget(courtId: string) {
    setEntries((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== courtId)));
  }

  function discard() {
    setEntries({});
    setRefused(new Set());
  }

  function saveCourts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = edited.filter((court) => !validNumber(entries[court.id].number));
    if (invalid.length > 0) {
      setRefused(new Set(invalid.map((court) => court.id)));
      refuse(t("admin.facility.courtNumberInvalid"));
      return Promise.resolve();
    }
    return save(MARK, () => saveInTurn(edited.map((court) => ({
      subject: t("court.number", { number: court.number }),
      run: async () => {
        const { number, name } = entries[court.id];
        const changed = await api.changeAdminCourt(court.id, { number: Number(number), name: name || undefined });
        setCourts((current) => current?.map((item) => item.id === changed.id ? changed : item));
        forget(court.id);
      }
    }))));
  }

  // Taking a court out of service is not a save, so it answers for `active` and for nothing else
  // the row is showing or somebody is editing.
  function toggle(court: AdminCourt) {
    return save(`court:${court.id}`, async () => {
      const { active } = await api.setAdminCourtActive(court.id, !court.active);
      setCourts((current) => current?.map((item) => item.id === court.id ? { ...item, active } : item));
    });
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    return save("court:new", async () => {
      const created = await api.createAdminCourt({
        number: Number(formString(form, "number")), name: formString(form, "name") || undefined
      });
      setCourts((current) => current && [...current, created]);
      formElement.reset();
    });
  }

  return <FacilityPage testId="admin-courts-view" title={t("admin.facility.courts")} error={error ?? clubError} success={success}>
    {courts !== undefined && club !== undefined && <>
      <form noValidate {...newCourt.form} onSubmit={(event) => void create(event)} className="grid gap-4 rounded-xl border p-4">
        <h2 className="font-bold">{t("admin.facility.newCourt")}</h2>
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr] sm:items-end">
          <TextField data-testid="new-court-number" disabled={pending.has("court:new")} name="number" type="number" label={t("admin.facility.number")} />
          <TextField data-testid="new-court-name" disabled={pending.has("court:new")} name="name" label={t("admin.facility.name")} />
        </div>
        <Button variant="primary" data-testid="create-court" disabled={pending.has("court:new")} className="justify-self-start" type="submit">{t("admin.create")}</Button>
      </form>
      <form id={FORM} noValidate onSubmit={(event) => void saveCourts(event)} className="grid gap-3">
        <h2 className="text-2xl font-bold">{t("admin.facility.allCourts")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th className="border-b p-2">{t("admin.facility.number")}</th>
                <th className="border-b p-2">{t("admin.facility.name")}</th>
                <th className="border-b p-2">{t("admin.facility.columnStatus")}</th>
                <th className="border-b p-2">{t("admin.facility.columnImpact")}</th>
              </tr>
            </thead>
            <tbody>
              {courts.map((court) => <CourtRow
                key={court.id}
                court={court}
                entry={entries[court.id] ?? stored(court)}
                refused={refused.has(court.id)}
                timeZone={club.timeZone}
                disabled={saving || pending.has(`court:${court.id}`)}
                entered={(changed) => enter(court, changed)}
                toggle={toggle}
                reportError={reportError}
              />)}
            </tbody>
          </table>
        </div>
        <SaveBar id={MARK} subject={t("admin.facility.courts")} saveTestId="save-courts" form={FORM}
                 unsaved={edited.length > 0} pending={saving} discard={discard} />
      </form>
    </>}
  </FacilityPage>;
}

function CourtRow({ court, entry, refused, timeZone, disabled, entered, toggle, reportError }: {
  court: AdminCourt;
  entry: CourtEntry;
  refused: boolean;
  timeZone: string;
  disabled: boolean;
  entered: (changed: Partial<CourtEntry>) => void;
  toggle: (court: AdminCourt) => Promise<void>;
  reportError: (failure: unknown) => void;
}) {
  const { t } = useTranslation();
  const field = "form-control min-h-11 rounded-lg border px-3 py-2";
  return <tr data-testid={`court-row-${court.id}`}>
    <td className="border-b p-2 align-top">
      <input data-testid={`edit-court-number-${court.id}`} className={`${field} w-24`} type="number"
             min={MIN_NUMBER} max={MAX_NUMBER} aria-label={t("admin.facility.editNumber")}
             aria-invalid={refused || undefined} disabled={disabled}
             value={entry.number} onChange={(event) => entered({ number: event.target.value })} />
    </td>
    <td className="border-b p-2 align-top">
      <input data-testid={`edit-court-name-${court.id}`} className={`${field} w-56`} maxLength={MAX_NAME}
             aria-label={t("admin.facility.editName")} placeholder={t("admin.facility.unnamedCourt")} disabled={disabled}
             value={entry.name} onChange={(event) => entered({ name: event.target.value })} />
    </td>
    <td className="border-b p-2 align-top">
      <span className="flex flex-wrap items-center gap-3">
        <span data-testid={`court-status-${court.id}`}>{t(court.active ? "admin.facility.statusActive" : "admin.facility.statusInactive")}</span>
        <Button variant={court.active ? "destructive" : "primary"} disabled={disabled} data-testid={`toggle-court-${court.id}`} type="button" onClick={() => void toggle(court)}>
          {t(court.active ? "admin.deactivate" : "admin.activate")}
        </Button>
      </span>
    </td>
    <td className="border-b p-2 align-top">
      <ImpactPanel kind="court" subject={court.id} timeZone={timeZone} ask={() => api.courtImpact(court.id)} reportError={reportError} />
    </td>
  </tr>;
}
