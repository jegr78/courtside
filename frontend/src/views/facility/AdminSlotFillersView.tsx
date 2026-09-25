import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type ParticipantCard } from "../../api/client";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { formString } from "../../forms/formString";
import { differs } from "../../unsaved/differs";
import { SaveBar } from "../../unsaved/SaveBar";
import { saveInTurn } from "../../unsaved/saveInTurn";
import { useUnsavedForm } from "../../unsaved/useUnsavedForm";
import { FacilityPage } from "./FacilityPage";
import { useSaving } from "./useSaving";

const MAX_LABEL = 60;
const MARK = "slot-fillers";
const FORM = "slot-fillers-form";

type FillerEntry = { label: string; capacity: string };

function stored(card: ParticipantCard): FillerEntry {
  return { label: card.label, capacity: card.capacity?.toString() ?? "" };
}

function validLabel(entry: FillerEntry): boolean {
  return entry.label.trim() !== "" && entry.label.length <= MAX_LABEL;
}

function validCapacity(entry: FillerEntry): boolean {
  if (entry.capacity.trim() === "") return true;
  const candidate = Number(entry.capacity);
  return Number.isInteger(candidate) && candidate >= 1 && candidate <= 99;
}

export function AdminSlotFillersView() {
  const { t } = useTranslation();
  const [fillers, setFillers] = useState<ParticipantCard[]>();
  const [entries, setEntries] = useState<Record<string, FillerEntry>>({});
  const [refused, setRefused] = useState<ReadonlySet<string>>(new Set());
  const { error, success, pending, reportError, refuse, clear, save } = useSaving();

  useEffect(() => {
    void api.adminParticipantCards()
      .then((loaded) => {
        setFillers(loaded);
      })
      .catch(reportError);
  }, [reportError]);

  const edited = (fillers ?? []).filter((card) => card.id in entries && differs(entries[card.id], stored(card)));
  const saving = pending.has(MARK);

  function replace(changed: ParticipantCard) {
    setFillers((current) => current?.some((item) => item.id === changed.id)
      ? current.map((item) => item.id === changed.id ? changed : item)
      : [...(current ?? []), changed]);
  }

  function enter(card: ParticipantCard, changed: Partial<FillerEntry>) {
    setEntries((current) => ({ ...current, [card.id]: { ...(current[card.id] ?? stored(card)), ...changed } }));
    setRefused((current) => {
      const next = new Set(current);
      next.delete(card.id);
      return next;
    });
  }

  function discard() {
    setEntries({});
    setRefused(new Set());
    clear();
  }

  function saveFillers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = edited.filter((card) => !validLabel(entries[card.id]) || !validCapacity(entries[card.id]));
    if (invalid.length > 0) {
      setRefused(new Set(invalid.map((card) => card.id)));
      refuse(t("admin.facility.participantCardInvalid"));
      return Promise.resolve();
    }
    return save(MARK, () => saveInTurn(edited.map((card) => ({
      subject: card.label,
      run: async () => {
        const { label, capacity } = entries[card.id];
        replace(await api.changeParticipantCard(card.id, { label, capacity: ownedCount(capacity) }));
        setEntries((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== card.id)));
      }
    }))));
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
      <form id={FORM} noValidate onSubmit={(event) => void saveFillers(event)} className="grid gap-3">
        <h2 className="text-2xl font-bold">{t("admin.facility.allParticipantCards")}</h2>
        <div className="overflow-x-auto"><table className="w-full border-collapse text-left">
          <thead><tr>
            <th className="border-b p-2">{t("admin.facility.label")}</th>
            <th className="border-b p-2">{t("admin.facility.owned")}</th>
            <th className="border-b p-2">{t("admin.facility.columnStatus")}</th>
          </tr></thead>
          <tbody>{fillers.map((card) => <ParticipantCardRow key={card.id} card={card}
            entry={entries[card.id] ?? stored(card)} refused={refused.has(card.id)}
            disabled={saving || pending.has(`filler:${card.id}`)}
            entered={(changed) => enter(card, changed)} toggle={toggle} />)}</tbody>
        </table></div>
        <SaveBar id={MARK} subject={t("admin.facility.participantCards")} saveTestId="save-slot-fillers" form={FORM}
                 unsaved={edited.length > 0} pending={saving} discard={discard} />
      </form>
    </>}
  </FacilityPage>;
}

function ParticipantCardRow({ card, entry, refused, disabled, entered, toggle }: { card: ParticipantCard; entry: FillerEntry; refused: boolean; disabled: boolean; entered: (changed: Partial<FillerEntry>) => void; toggle: (card: ParticipantCard) => Promise<void> }) {
  const { t } = useTranslation();
  const field = "form-control min-h-11 rounded-lg border px-3 py-2";
  return <tr data-testid={`participant-card-row-${card.id}`}>
    <td className="border-b p-2 align-top">
      <input data-testid={`edit-participant-card-label-${card.id}`} className={`${field} w-56`} maxLength={MAX_LABEL}
             aria-label={t("admin.facility.editParticipantCardLabel")} aria-invalid={(refused && !validLabel(entry)) || undefined}
             disabled={disabled} value={entry.label} onChange={(event) => entered({ label: event.target.value })} />
    </td>
    <td className="border-b p-2 align-top">
      <input data-testid={`edit-participant-card-capacity-${card.id}`} className={`${field} w-28`} type="number" min={1} max={99}
             aria-label={t("admin.facility.editParticipantCardCapacity")} aria-invalid={(refused && !validCapacity(entry)) || undefined}
             placeholder={t("admin.facility.unlimited")}
             disabled={disabled} value={entry.capacity} onChange={(event) => entered({ capacity: event.target.value })} />
    </td>
    <td className="border-b p-2 align-top"><span className="flex flex-wrap items-center gap-3">
      <span data-testid={`participant-card-status-${card.id}`}>{t(card.active ? "admin.facility.statusActive" : "admin.facility.statusInactive")}</span>
      <Button variant={card.active ? "destructive" : "primary"} disabled={disabled} data-testid={`toggle-participant-card-${card.id}`} type="button" onClick={() => void toggle(card)}>{t(card.active ? "admin.deactivate" : "admin.activate")}</Button>
    </span></td>
  </tr>;
}

function ParticipantCardCreateForm({ disabled, create }: { disabled: boolean; create: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  const { t } = useTranslation();
  const { form } = useUnsavedForm("participant-card:new");
  return <form noValidate {...form} onSubmit={(event) => void create(event)} className="grid gap-4 rounded-xl border p-4">
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
