import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type ParticipantCard } from "../../api/client";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { formString } from "../../forms/formString";
import { describedByMark } from "../../unsaved/markId";
import { UnsavedMark } from "../../unsaved/UnsavedMark";
import { useUnsavedForm } from "../../unsaved/useUnsavedForm";
import { FacilityPage } from "./FacilityPage";
import { useSaving } from "./useSaving";

const MAX_LABEL = 60;
type Field = "label" | "capacity";
type Cell = { cardId: string; field: Field };
type CellEditor = Cell & { entry: string };

function shown(card: ParticipantCard, field: Field): string {
  return field === "label" ? card.label : card.capacity?.toString() ?? "";
}

function confirmable(editor: CellEditor): boolean {
  if (editor.field === "label") return editor.entry.trim() !== "" && editor.entry.length <= MAX_LABEL;
  if (editor.entry.trim() === "") return true;
  const candidate = Number(editor.entry);
  return Number.isInteger(candidate) && candidate >= 1 && candidate <= 99;
}

export function AdminSlotFillersView() {
  const { t } = useTranslation();
  const [fillers, setFillers] = useState<ParticipantCard[]>();
  const [editor, setEditor] = useState<CellEditor>();
  const [restored, setRestored] = useState<Cell>();
  const open = useRef<CellEditor | undefined>(undefined);
  const { error, success, pending, reportError, save } = useSaving();

  useEffect(() => {
    void api.adminParticipantCards()
      .then((loaded) => {
        setFillers(loaded);
      })
      .catch(reportError);
  }, [reportError]);

  useEffect(() => { open.current = editor; }, [editor]);

  function replace(changed: ParticipantCard) {
    setFillers((current) => current?.some((item) => item.id === changed.id)
      ? current.map((item) => item.id === changed.id ? changed : item)
      : [...(current ?? []), changed]);
  }

  function close(closing: Cell) {
    if (open.current?.cardId !== closing.cardId || open.current.field !== closing.field) return;
    setRestored(closing);
    setEditor(undefined);
  }

  function confirmEdit() {
    const card = fillers?.find((item) => item.id === editor?.cardId);
    if (!editor || !card || !confirmable(editor)) return Promise.resolve();
    const request = editor.field === "label"
      ? { label: editor.entry, capacity: card.capacity ?? null }
      : { label: card.label, capacity: ownedCount(editor.entry) };
    return save(`filler:${card.id}`, async () => {
      replace(await api.changeParticipantCard(card.id, request));
      close(editor);
    });
  }

  function toggle(card: ParticipantCard) {
    return save(`filler:${card.id}`, async () => {
      // Taking a filler out of service is not a save, so it answers for `active` and for nothing else
      const { active } = await api.setParticipantCardActive(card.id, !card.active);
      setFillers((current) => current?.map((item) => item.id === card.id ? { ...item, active } : item));
    });
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    return save("filler:new", async () => {
      replace(await api.createParticipantCard({
        label: formString(form, "label"),
        capacity: ownedCount(formString(form, "capacity"))
      }));
      formElement.reset();
    });
  }

  return <FacilityPage testId="admin-slot-fillers-view" title={t("admin.facility.participantCards")} error={error} success={success}>
    {fillers !== undefined && <>
      <p className="text-sm">{t("admin.facility.participantCardsHint")}</p>
      <ParticipantCardCreateForm disabled={pending.has("filler:new")} create={create} />
      <section className="grid gap-3">
        <h2 className="text-2xl font-bold">{t("admin.facility.allParticipantCards")}</h2>
        <div className="overflow-x-auto"><table className="w-full border-collapse text-left">
          <thead><tr>
            <th className="border-b p-2">{t("admin.facility.label")}</th>
            <th className="border-b p-2">{t("admin.facility.owned")}</th>
            <th className="border-b p-2">{t("admin.facility.columnStatus")}</th>
          </tr></thead>
          <tbody>{fillers.map((card) => <ParticipantCardRow key={card.id} card={card}
            editor={editor?.cardId === card.id ? editor : undefined}
            restored={restored?.cardId === card.id ? restored.field : undefined}
            disabled={pending.has(`filler:${card.id}`)}
            open={(field) => setEditor({ cardId: card.id, field, entry: shown(card, field) })}
            entered={(entry) => setEditor((current) => current && { ...current, entry })}
            confirm={confirmEdit} dismiss={close} toggle={toggle} />)}</tbody>
        </table></div>
      </section>
    </>}
  </FacilityPage>;
}

function ParticipantCardRow({ card, editor, restored, disabled, open, entered, confirm, dismiss, toggle }: { card: ParticipantCard; editor?: CellEditor; restored?: Field; disabled: boolean; open: (field: Field) => void; entered: (entry: string) => void; confirm: () => Promise<void>; dismiss: (cell: Cell) => void; toggle: (card: ParticipantCard) => Promise<void> }) {
  const { t } = useTranslation();
  const mark = `participant-card:${card.id}`;
  const unsaved = editor !== undefined && editor.entry !== shown(card, editor.field);
  return <tr data-testid={`participant-card-row-${card.id}`}>
    {(["label", "capacity"] as Field[]).map((field) => <td key={field} className="border-b p-2 align-top">
      {editor?.field === field
        ? <ParticipantCardCellEditor editor={editor} mark={mark} unsaved={unsaved} disabled={disabled} entered={entered} confirm={confirm} dismiss={() => dismiss(editor)} />
        : <ParticipantCardCellValue card={card} field={field} disabled={disabled} focused={restored === field} open={() => open(field)} />}
    </td>)}
    <td className="border-b p-2 align-top"><span className="flex flex-wrap items-center gap-3">
      <span data-testid={`participant-card-status-${card.id}`}>{t(card.active ? "admin.facility.statusActive" : "admin.facility.statusInactive")}</span>
      <Button variant={card.active ? "destructive" : "primary"} disabled={disabled} data-testid={`toggle-participant-card-${card.id}`} type="button" onClick={() => void toggle(card)}>{t(card.active ? "admin.deactivate" : "admin.activate")}</Button>
    </span></td>
  </tr>;
}

function ParticipantCardCellValue({ card, field, disabled, focused, open }: { card: ParticipantCard; field: Field; disabled: boolean; focused: boolean; open: () => void }) {
  const { t } = useTranslation();
  const value = shown(card, field);
  return <button autoFocus={focused} type="button" disabled={disabled} onClick={open}
    data-testid={`edit-participant-card-${field}-${card.id}`}
    className="min-h-11 min-w-20 cursor-pointer rounded-lg border border-dashed px-3 py-2 text-left hover:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed">
    {value || t(field === "capacity" ? "admin.facility.unlimited" : "admin.facility.unnamedCourt")}
    <span className="sr-only">{t(field === "label" ? "admin.facility.editParticipantCardLabel" : "admin.facility.editParticipantCardCapacity")}</span>
  </button>;
}

function ParticipantCardCellEditor({ editor, mark, unsaved, disabled, entered, confirm, dismiss }: { editor: CellEditor; mark: string; unsaved: boolean; disabled: boolean; entered: (entry: string) => void; confirm: () => Promise<void>; dismiss: () => void }) {
  const { t } = useTranslation();
  const capacity = editor.field === "capacity";
  function keyed(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") void confirm();
    if (event.key === "Escape") dismiss();
  }
  return <span className="flex flex-wrap items-center gap-2">
    <input autoFocus data-testid="participant-card-editor" className="form-control min-h-11 w-48 rounded-lg border px-3 py-2 outline-none"
      aria-label={t(capacity ? "admin.facility.owned" : "admin.facility.label")}
      type={capacity ? "number" : "text"} min={capacity ? 1 : undefined} max={capacity ? 99 : undefined}
      maxLength={capacity ? undefined : MAX_LABEL} value={editor.entry} disabled={disabled}
      onChange={(event) => entered(event.target.value)} onKeyDown={keyed} />
    <Button variant="primary" data-testid="confirm-participant-card-edit" type="button" disabled={disabled || !confirmable(editor)} aria-describedby={describedByMark(mark, unsaved)} onClick={() => void confirm()}>{t("admin.save")}</Button>
    <Button variant="secondary" data-testid="dismiss-participant-card-edit" type="button" disabled={disabled} onClick={dismiss}>{t("admin.cancel")}</Button>
    <UnsavedMark id={mark} unsaved={unsaved} />
  </span>;
}

function ParticipantCardCreateForm({ disabled, create }: { disabled: boolean; create: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  const { t } = useTranslation();
  const { form } = useUnsavedForm("participant-card:new");
  return <form noValidate {...form} onSubmit={(event) => void create(event)} className="surface-subtle grid gap-4 rounded-xl border p-4">
    <h2 className="font-bold">{t("admin.facility.newParticipantCard")}</h2>
    <div className="grid gap-3 md:grid-cols-2">
      <TextField disabled={disabled} data-testid="new-participant-card-label" name="label" label={t("admin.facility.label")} />
      <TextField disabled={disabled} data-testid="new-participant-card-capacity" name="capacity" type="number" min={1} max={99} label={t("admin.facility.owned")} />
    </div>
    <Button variant="primary" disabled={disabled} data-testid="create-participant-card" className="justify-self-start" type="submit">{t("admin.create")}</Button>
  </form>;
}

// An empty field is how a board says "any number of them", which the contract spells as absent.
function ownedCount(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}
