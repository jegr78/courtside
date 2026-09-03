import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type ParticipantCard, type ParticipantCardRequest } from "../../api/client";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { formString } from "../../forms/formString";
import { differs } from "../../unsaved/differs";
import { describedByMark } from "../../unsaved/markId";
import { UnsavedMark } from "../../unsaved/UnsavedMark";
import { useUnsavedForm } from "../../unsaved/useUnsavedForm";
import { FacilityPage } from "./FacilityPage";
import { useSaving } from "./useSaving";

export function AdminSlotFillersView() {
  const { t } = useTranslation();
  const [fillers, setFillers] = useState<ParticipantCard[]>();
  const [confirmed, setConfirmed] = useState<Record<string, ParticipantCard>>({});
  const { error, success, pending, reportError, save } = useSaving();

  useEffect(() => {
    void api.adminParticipantCards()
      .then((loaded) => {
        setFillers(loaded);
        setConfirmed(Object.fromEntries(loaded.map((card) => [card.id, card])));
      })
      .catch(reportError);
  }, [reportError]);

  function confirm(changed: ParticipantCard) {
    setFillers((current) => current?.some((item) => item.id === changed.id)
      ? current.map((item) => item.id === changed.id ? changed : item)
      : [...(current ?? []), changed]);
    setConfirmed((current) => ({ ...current, [changed.id]: changed }));
  }

  function applyEdit(changed: ParticipantCard) {
    setFillers((current) => current?.map((item) => item.id === changed.id ? changed : item));
  }

  function saveFiller(card: ParticipantCard) {
    return save(`filler:${card.id}`, async () =>
      confirm(await api.changeParticipantCard(card.id, fillerRequest(card))));
  }

  function toggle(card: ParticipantCard) {
    return save(`filler:${card.id}`, async () => {
      // Taking a filler out of service is not a save, so it answers for `active` and for nothing else
      const { active } = await api.setParticipantCardActive(card.id, !card.active);
      setFillers((current) => current?.map((item) => item.id === card.id ? { ...item, active } : item));
      setConfirmed((current) => {
        const stored = current[card.id];
        return stored ? { ...current, [card.id]: { ...stored, active } } : current;
      });
    });
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    return save("filler:new", async () => {
      confirm(await api.createParticipantCard({
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
      {fillers.map((card) => <ParticipantCardEditor
        key={card.id}
        card={card}
        confirmed={confirmed[card.id]}
        disabled={pending.has(`filler:${card.id}`)}
        changed={applyEdit}
        save={saveFiller}
        toggle={toggle}
      />)}
    </>}
  </FacilityPage>;
}

function ParticipantCardEditor({ card, confirmed, disabled, changed, save, toggle }: { card: ParticipantCard; confirmed?: ParticipantCard; disabled: boolean; changed: (card: ParticipantCard) => void; save: (card: ParticipantCard) => Promise<void>; toggle: (card: ParticipantCard) => Promise<void> }) {
  const { t } = useTranslation();
  const mark = `participant-card:${card.id}`;
  const unsaved = differs(card, confirmed);
  return <article className="surface-subtle grid gap-4 rounded-xl border p-4">
    <div className="grid gap-3 md:grid-cols-2">
      <TextField disabled={disabled} data-testid={`participant-card-label-${card.id}`} label={t("admin.facility.label")} value={card.label} onChange={(event) => changed({ ...card, label: event.target.value })} />
      <TextField disabled={disabled} data-testid={`participant-card-capacity-${card.id}`} type="number" min={1} max={99} label={t("admin.facility.owned")} value={card.capacity ?? ""} onChange={(event) => changed({ ...card, capacity: ownedCount(event.target.value) })} />
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" disabled={disabled} data-testid={`save-participant-card-${card.id}`} aria-describedby={describedByMark(mark, unsaved)} type="button" onClick={() => void save(card)}>{t("admin.save")}</Button>
      <Button variant={card.active ? "destructive" : "primary"} disabled={disabled} data-testid={`toggle-participant-card-${card.id}`} type="button" onClick={() => void toggle(card)}>{t(card.active ? "admin.deactivate" : "admin.activate")}</Button>
      <UnsavedMark id={mark} unsaved={unsaved} />
    </div>
  </article>;
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

function fillerRequest(card: ParticipantCard): ParticipantCardRequest {
  return { label: card.label, capacity: card.capacity ?? null };
}
