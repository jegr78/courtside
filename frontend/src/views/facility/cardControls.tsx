import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Role } from "../../api/client";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";

const MIN_PLAYER_COUNT = 1;
const MAX_PLAYER_COUNT = 20;
const MAX_PLAYER_COUNTS = 20;

const roles: Role[] = ["MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER", "TREASURER"];
// The server strips MEMBER before matching a managing role.
const managingRoleOptions: Role[] = roles.filter((role) => role !== "MEMBER");

export function Checkbox({ name, label, checked, disabled, value, changed, ...props }: { name?: string; label: string; checked?: boolean; disabled?: boolean; value?: string; changed?: (checked: boolean) => void; "data-testid"?: string }) {
  return <label className="flex items-center gap-3 font-medium"><input data-testid={props["data-testid"]} name={name} disabled={disabled} type="checkbox" value={value} checked={changed ? checked : undefined} onChange={changed ? (event) => changed(event.target.checked) : undefined} />{label}</label>;
}

function RoleCheckboxes({ options, legendKey, hintKey, hintTestId, name, selected, disabled, changed, testIdPrefix }: { options: Role[]; legendKey: string; hintKey: string; hintTestId: string; name?: string; selected: Role[]; disabled?: boolean; changed?: (roles: Role[]) => void; testIdPrefix?: string }) {
  const { t } = useTranslation();
  function toggle(role: Role, checked: boolean) {
    changed?.(checked ? [...selected, role] : selected.filter((candidate) => candidate !== role));
  }
  return <fieldset className="grid gap-2" aria-describedby={hintTestId}>
    <legend className="font-medium">{t(legendKey)}</legend>
    <p id={hintTestId} data-testid={hintTestId} className="text-[var(--cs-muted)]">{t(hintKey)}</p>
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((role) => <Checkbox key={role} data-testid={testIdPrefix ? `${testIdPrefix}-${role}` : undefined} name={name} disabled={disabled} label={t(`role.${role}`)} checked={selected.includes(role)} value={role} changed={changed ? (checked) => toggle(role, checked) : undefined} />)}
    </div>
  </fieldset>;
}

export function AllowedRoleCheckboxes(props: { name?: string; selected: Role[]; disabled?: boolean; changed?: (roles: Role[]) => void; testIdPrefix?: string }) {
  return <RoleCheckboxes {...props} options={roles} legendKey="admin.facility.allowedRoles" hintKey="admin.facility.allowedRolesHint" hintTestId="allowed-roles-hint" />;
}

export function ManagingRoleCheckboxes(props: { name?: string; selected: Role[]; disabled?: boolean; changed?: (roles: Role[]) => void; testIdPrefix?: string }) {
  return <RoleCheckboxes {...props} options={managingRoleOptions} legendKey="admin.facility.managingRoles" hintKey="admin.facility.managingRolesHint" hintTestId="managing-roles-hint" />;
}

export function PlayerCounts({ counts, disabled, changed, idPrefix }: { counts: number[]; disabled?: boolean; changed: (counts: number[]) => void; idPrefix: string }) {
  const { t } = useTranslation();
  const [entry, setEntry] = useState("");
  // Not parseInt: a number field accepts "1e3" and "3.9", which it would read as 1 and 3.
  const candidate = Number(entry);
  const addable = Number.isInteger(candidate)
    && candidate >= MIN_PLAYER_COUNT && candidate <= MAX_PLAYER_COUNT
    && !counts.includes(candidate) && counts.length < MAX_PLAYER_COUNTS;

  function add() {
    if (!addable) return;
    changed([...counts, candidate].sort((left, right) => left - right));
    setEntry("");
  }

  return <fieldset className="grid gap-2" aria-describedby={`${idPrefix}-hint`}>
    <legend className="font-medium">{t("admin.facility.playerCounts")}</legend>
    <p id={`${idPrefix}-hint`} data-testid={`${idPrefix}-hint`} className="text-[var(--cs-muted)]">{t("admin.facility.playerCountsHint")}</p>
    <ul data-testid={`${idPrefix}-list`} className="flex flex-wrap gap-2">
      {counts.map((count) => <li key={count}>
        <Button variant="secondary" type="button" disabled={disabled} data-testid={`${idPrefix}-remove-${count}`} aria-label={t("admin.facility.removePlayerCount", { players: count })} onClick={() => changed(counts.filter((chosen) => chosen !== count))}>
          {count} <span aria-hidden="true">×</span>
        </Button>
      </li>)}
    </ul>
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-28"><TextField className="w-full" data-testid={`${idPrefix}-entry`} type="number" min={MIN_PLAYER_COUNT} max={MAX_PLAYER_COUNT} disabled={disabled} label={t("admin.facility.addPlayerCount")} value={entry} onChange={(event) => setEntry(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} /></div>
      <Button variant="secondary" type="button" data-testid={`${idPrefix}-add`} disabled={disabled || !addable} onClick={add}>{t("admin.add")}</Button>
    </div>
  </fieldset>;
}

export function ColorField({ value, disabled, changed, name, testId }: { value?: string; disabled?: boolean; changed?: (color: string) => void; name?: string; testId?: string }) {
  const { t } = useTranslation();
  return <TextField
    className="cursor-pointer"
    // A padding class would compete with the field's own, and Tailwind decides that by
    // the order it emitted the utilities in rather than the order they are written in.
    style={{ height: "3rem", width: "6rem", padding: "0.25rem" }}
    data-testid={testId}
    name={name}
    type="color"
    disabled={disabled}
    label={t("admin.facility.color")}
    defaultValue={changed ? undefined : "#b85c38"}
    value={changed ? value : undefined}
    onChange={changed ? (event) => changed(event.target.value) : undefined}
  />;
}

export function BookingRules({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return <fieldset className="grid content-start gap-2">
    <legend className="font-medium">{t("admin.facility.bookingRules")}</legend>
    {children}
  </fieldset>;
}
