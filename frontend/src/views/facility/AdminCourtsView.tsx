import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type AdminCourt } from "../../api/client";
import { useClubConfiguration } from "../../club/registry";
import { Button } from "../../components/Button";
import { ImpactPanel } from "../../components/ImpactPanel";
import { TextField } from "../../components/TextField";
import { formString } from "../../forms/formString";
import { describedByMark } from "../../unsaved/markId";
import { UnsavedMark } from "../../unsaved/UnsavedMark";
import { useUnsavedForm } from "../../unsaved/useUnsavedForm";
import { FacilityPage } from "./FacilityPage";
import { useSaving } from "./useSaving";

const MIN_NUMBER = 1;
const MAX_NUMBER = 999;
const MAX_NAME = 60;

type Field = "number" | "name";
type CellEditor = { courtId: string; field: Field; entry: string };

function shown(court: AdminCourt, field: Field): string {
  return field === "number" ? String(court.number) : court.name ?? "";
}

function confirmable(editor: CellEditor): boolean {
  if (editor.field === "name") return editor.entry.length <= MAX_NAME;
  // Not parseInt: a number field accepts "1e3" and "3.9", which it would read as 1 and 3.
  const candidate = Number(editor.entry);
  return editor.entry.trim() !== "" && Number.isInteger(candidate)
    && candidate >= MIN_NUMBER && candidate <= MAX_NUMBER;
}

export function AdminCourtsView() {
  const { t } = useTranslation();
  const { club, error: clubError } = useClubConfiguration();
  const [courts, setCourts] = useState<AdminCourt[]>();
  const [editor, setEditor] = useState<CellEditor>();
  const { error, success, pending, reportError, save } = useSaving();
  const newCourt = useUnsavedForm("court:new");

  useEffect(() => {
    void api.adminCourts().then(setCourts).catch(reportError);
  }, [reportError]);

  const edited = courts?.find((court) => court.id === editor?.courtId);

  function replace(changed: AdminCourt) {
    setCourts((current) => current?.map((court) => court.id === changed.id ? changed : court));
  }

  function confirmEdit() {
    if (!editor || !edited || !confirmable(editor)) return Promise.resolve();
    const request = editor.field === "number"
      ? { number: Number(editor.entry), name: edited.name ?? undefined }
      : { number: edited.number, name: editor.entry || undefined };
    return save(`court:${editor.courtId}`, async () => {
      replace(await api.changeAdminCourt(editor.courtId, request));
      setEditor(undefined);
    });
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
      setCourts((current) => [...(current ?? []), created]);
      formElement.reset();
    });
  }

  return <FacilityPage testId="admin-courts-view" title={t("admin.facility.courts")} error={error ?? clubError} success={success}>
    {courts !== undefined && club !== undefined && <>
      <form noValidate {...newCourt.form} onSubmit={(event) => void create(event)} className="surface-subtle grid gap-4 rounded-xl border p-4">
        <h2 className="font-bold">{t("admin.facility.newCourt")}</h2>
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr] sm:items-end">
          <TextField data-testid="new-court-number" disabled={pending.has("court:new")} name="number" type="number" label={t("admin.facility.number")} />
          <TextField data-testid="new-court-name" disabled={pending.has("court:new")} name="name" label={t("admin.facility.name")} />
        </div>
        <Button variant="primary" data-testid="create-court" disabled={pending.has("court:new")} className="justify-self-start" type="submit">{t("admin.create")}</Button>
      </form>
      <section className="grid gap-3">
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
                editor={editor?.courtId === court.id ? editor : undefined}
                timeZone={club.timeZone}
                disabled={pending.has(`court:${court.id}`)}
                open={(field) => setEditor({ courtId: court.id, field, entry: shown(court, field) })}
                entered={(entry) => setEditor((current) => current && { ...current, entry })}
                confirm={confirmEdit}
                dismiss={() => setEditor(undefined)}
                toggle={toggle}
                reportError={reportError}
              />)}
            </tbody>
          </table>
        </div>
      </section>
    </>}
  </FacilityPage>;
}

function CourtRow({ court, editor, timeZone, disabled, open, entered, confirm, dismiss, toggle, reportError }: {
  court: AdminCourt;
  editor?: CellEditor;
  timeZone: string;
  disabled: boolean;
  open: (field: Field) => void;
  entered: (entry: string) => void;
  confirm: () => Promise<void>;
  dismiss: () => void;
  toggle: (court: AdminCourt) => Promise<void>;
  reportError: (failure: unknown) => void;
}) {
  const { t } = useTranslation();
  const mark = `court:${court.id}`;
  const unsaved = editor !== undefined && editor.entry !== shown(court, editor.field);
  return <tr data-testid={`court-row-${court.id}`}>
    {(["number", "name"] as Field[]).map((field) => <td key={field} className="border-b p-2 align-top">
      {editor?.field === field
        ? <CellEditorControls
            editor={editor} mark={mark} unsaved={unsaved} disabled={disabled}
            entered={entered} confirm={confirm} dismiss={dismiss} />
        : <CellValue court={court} field={field} disabled={disabled} open={() => open(field)} />}
    </td>)}
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

function CellValue({ court, field, disabled, open }: { court: AdminCourt; field: Field; disabled: boolean; open: () => void }) {
  const { t } = useTranslation();
  const value = field === "number" ? String(court.number) : court.name;
  return <button
    data-testid={`edit-court-${field}-${court.id}`}
    className="min-h-11 w-full cursor-pointer rounded-md px-2 py-2 text-left underline decoration-dotted underline-offset-4 hover:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:no-underline"
    type="button"
    disabled={disabled}
    onClick={open}
  >
    {value ?? t("admin.facility.unnamedCourt")}
    <span className="sr-only">{t(field === "number" ? "admin.facility.editNumber" : "admin.facility.editName")}</span>
  </button>;
}

function CellEditorControls({ editor, mark, unsaved, disabled, entered, confirm, dismiss }: {
  editor: CellEditor;
  mark: string;
  unsaved: boolean;
  disabled: boolean;
  entered: (entry: string) => void;
  confirm: () => Promise<void>;
  dismiss: () => void;
}) {
  const { t } = useTranslation();
  const number = editor.field === "number";

  function keyed(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") void confirm();
    if (event.key === "Escape") dismiss();
  }

  return <span className="flex flex-wrap items-center gap-2">
    <input
      autoFocus
      data-testid="court-editor"
      className="form-control min-h-11 w-32 rounded-lg border px-3 py-2 outline-none"
      aria-label={t(number ? "admin.facility.number" : "admin.facility.name")}
      type={number ? "number" : "text"}
      min={number ? MIN_NUMBER : undefined}
      max={number ? MAX_NUMBER : undefined}
      maxLength={number ? undefined : MAX_NAME}
      value={editor.entry}
      disabled={disabled}
      onChange={(event) => entered(event.target.value)}
      onKeyDown={keyed}
    />
    <Button variant="primary" data-testid="confirm-court-edit" type="button"
            disabled={disabled || !confirmable(editor)}
            aria-describedby={describedByMark(mark, unsaved)}
            onClick={() => void confirm()}>{t("admin.save")}</Button>
    <Button variant="secondary" data-testid="dismiss-court-edit" type="button"
            disabled={disabled} onClick={dismiss}>{t("admin.cancel")}</Button>
    <UnsavedMark id={mark} unsaved={unsaved} />
  </span>;
}
