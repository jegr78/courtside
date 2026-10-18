import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type MembershipPeriod, type MembershipPeriodRequest, type MembershipType } from "../api/client";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { TextField } from "../components/TextField";
import { useReportedFailure } from "../failures/useReportedFailure";

type PeriodState = "running" | "scheduled" | "ended";

type Editing = { period?: MembershipPeriod };

const STATES: Record<MembershipPeriod["state"], PeriodState> = {
  RUNNING: "running", SCHEDULED: "scheduled", ENDED: "ended",
};

export function MembershipPeriodsSection({ personId, types, disabled, version, changed }: {
  personId: string;
  types: MembershipType[];
  disabled: boolean;
  version: string;
  changed: () => void;
}) {
  const { t } = useTranslation();
  const { message: error, report, clear } = useReportedFailure();
  const [periods, setPeriods] = useState<MembershipPeriod[]>();
  const [editing, setEditing] = useState<Editing>();
  const [removing, setRemoving] = useState<MembershipPeriod>();
  const [pending, setPending] = useState(false);
  const names = new Map(types.map((type) => [type.id, type.name]));

  useEffect(() => {
    let active = true;
    void api.membershipPeriods(personId)
      .then((read) => { if (active) setPeriods(read); })
      .catch((failure: unknown) => { if (active) report(failure); });
    return () => { active = false; };
  }, [personId, version, report]);

  async function run(change: () => Promise<unknown>): Promise<boolean> {
    setPending(true);
    clear();
    try {
      await change();
      setPeriods(await api.membershipPeriods(personId));
      changed();
      return true;
    } catch (failure) {
      report(failure);
      return false;
    } finally {
      setPending(false);
    }
  }

  async function save(request: MembershipPeriodRequest) {
    const period = editing?.period;
    const saved = await run(() => period
      ? api.correctMembershipPeriod(personId, period.id, request)
      : api.addMembershipPeriod(personId, request));
    if (saved) setEditing(undefined);
  }

  async function remove(period: MembershipPeriod) {
    if (await run(() => api.removeMembershipPeriod(personId, period.id))) setRemoving(undefined);
  }

  const busy = disabled || pending;

  return <section data-testid="membership-periods" aria-labelledby="membership-periods-title" className="grid gap-3 rounded-xl border p-4">
    <h2 id="membership-periods-title" className="text-2xl font-bold">{t("admin.person.periods")}</h2>
    <p className="text-muted text-sm">{t("admin.person.periodsExplain")}</p>
    {error && !editing && !removing && <Alert>{error}</Alert>}
    {periods && (periods.length === 0
      ? <p data-testid="membership-periods-none" className="text-muted">{t("admin.person.periodsNone")}</p>
      : <ul data-testid="membership-periods-list" className="grid gap-2">
        {periods.map((period) => {
          const state = STATES[period.state];
          return <li key={period.id} data-testid={`membership-period-${period.id}`} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <span className="min-w-0 grow break-words">
              <span className="font-semibold">{names.get(period.membershipTypeId) ?? period.membershipTypeId}</span>
              {" "}
              {period.endedOn
                ? t("admin.person.periodRange", { startedOn: period.startedOn, endedOn: period.endedOn })
                : t("admin.person.periodOpen", { startedOn: period.startedOn })}
            </span>
            <span data-testid={`membership-period-state-${period.id}`} data-state={state} className="text-sm font-medium">
              {t(`admin.person.periodState.${state}`)}
            </span>
            <Button variant="secondary" data-testid={`correct-period-${period.id}`} disabled={busy} type="button"
                    onClick={() => { clear(); setEditing({ period }); }}>{t("admin.person.correctPeriod")}</Button>
            <Button variant="destructive" data-testid={`remove-period-${period.id}`} disabled={busy} type="button"
                    onClick={() => { clear(); setRemoving(period); }}>{t("admin.person.removePeriod")}</Button>
          </li>;
        })}
      </ul>)}
    <Button variant="secondary" data-testid="add-period" disabled={busy || !periods} className="justify-self-start" type="button"
            onClick={() => { clear(); setEditing({}); }}>{t("admin.person.addPeriod")}</Button>
    {editing && <PeriodForm period={editing.period} types={types} pending={pending} error={error}
                            save={(request) => void save(request)} closed={() => { clear(); setEditing(undefined); }} />}
    {removing && <Modal labelledBy="remove-period-title" closed={() => { clear(); setRemoving(undefined); }}>
      <div className="grid gap-4">
        <h2 id="remove-period-title" className="text-2xl font-bold">{t("admin.person.removePeriodTitle")}</h2>
        <p>{t("admin.person.removePeriodExplain")}</p>
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button variant="destructive-confirm" data-testid="confirm-remove-period" disabled={pending} type="button"
                  onClick={() => void remove(removing)}>{t("admin.person.removePeriod")}</Button>
          <Button variant="secondary" data-testid="cancel-remove-period" type="button"
                  onClick={() => { clear(); setRemoving(undefined); }}>{t("admin.cancel")}</Button>
        </div>
      </div>
    </Modal>}
  </section>;
}

function PeriodForm({ period, types, pending, error, save, closed }: {
  period?: MembershipPeriod;
  types: MembershipType[];
  pending: boolean;
  error?: string;
  save: (request: MembershipPeriodRequest) => void;
  closed: () => void;
}) {
  const { t } = useTranslation();
  const [membershipTypeId, setMembershipTypeId] = useState(period?.membershipTypeId ?? "");
  const [startedOn, setStartedOn] = useState(period?.startedOn ?? "");
  const [endedOn, setEndedOn] = useState(period?.endedOn ?? "");
  const offered = types.filter((type) => type.active || type.id === period?.membershipTypeId);

  function submit(event: FormEvent) {
    event.preventDefault();
    save({ membershipTypeId, startedOn, endedOn: endedOn || null });
  }

  return <Modal labelledBy="period-form-title" closed={closed}>
    <form className="grid gap-4" onSubmit={submit}>
      <h2 id="period-form-title" className="text-2xl font-bold">
        {t(period ? "admin.person.correctPeriodTitle" : "admin.person.addPeriodTitle")}
      </h2>
      {error && <Alert>{error}</Alert>}
      <label className="grid gap-2 font-medium">
        {t("admin.person.membershipType")}
        <select data-testid="period-type" required className="form-control rounded-lg border px-3 py-3" value={membershipTypeId}
                onChange={(event) => setMembershipTypeId(event.target.value)}>
          <option value="">{t("admin.person.chooseMembershipType")}</option>
          {offered.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
        </select>
      </label>
      <TextField data-testid="period-started-on" required type="date" label={t("admin.person.startedOn")} value={startedOn}
                 onChange={(event) => setStartedOn(event.target.value)} />
      <TextField data-testid="period-ended-on" type="date" label={t("admin.person.endedOn")} value={endedOn}
                 aria-describedby="period-ended-on-hint" onChange={(event) => setEndedOn(event.target.value)} />
      <p id="period-ended-on-hint" className="text-muted text-sm">{t("admin.person.endedOnHint")}</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" data-testid="save-period" disabled={pending || !membershipTypeId || !startedOn} type="submit">
          {t("admin.person.savePeriod")}
        </Button>
        <Button variant="secondary" data-testid="cancel-period" type="button" onClick={closed}>{t("admin.cancel")}</Button>
      </div>
    </form>
  </Modal>;
}
