import type { TFunction } from "i18next";
import type { AuditEntry, DayOfWeek } from "../api/client";
import { shortTime } from "../time/clubZone";

const enabledFlagByEventType: Record<string, string> = {
  "roster.account.availabilityChanged": "enabled"
};

const isoWeekdayNumbers: Record<DayOfWeek, number> = {
  MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7
};

const weekdayByIsoNumber = new Map<number, DayOfWeek>(
  Object.entries(isoWeekdayNumbers).map(([weekday, isoNumber]) => [isoNumber, weekday as DayOfWeek]));

const nullSafeContexts: { eventType: string; field: string; context: string }[] = [
  { eventType: "card.participantCard.added", field: "capacity", context: "unlimited" },
  { eventType: "roster.membership.written", field: "startedOn", context: "unknownStart" }
];

function paramsLabel(params: Record<string, unknown>, t: TFunction): string {
  return Object.entries(params)
    .map(([name, value]) => `${t(`admin.rules.parameter.${name}`)}: ${String(value)}`)
    .join(", ");
}

function weekdayLabel(entry: AuditEntry, t: TFunction): string | undefined {
  const dayOfWeek = entry.parameters.dayOfWeek;
  const weekday = typeof dayOfWeek === "number" ? weekdayByIsoNumber.get(dayOfWeek) : undefined;
  return weekday === undefined ? undefined : t(`weekday.${weekday}`);
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

function contextFor(entry: AuditEntry): string | undefined {
  if (entry.eventType.endsWith(".availabilityChanged")) {
    const flagKey = enabledFlagByEventType[entry.eventType] ?? "active";
    return entry.parameters[flagKey] ? "active" : "inactive";
  }
  return nullSafeContexts.find((candidate) => candidate.eventType === entry.eventType
    && isNullish(entry.parameters[candidate.field]))?.context;
}

export function auditMessage(entry: AuditEntry, t: TFunction): string {
  const context = contextFor(entry);
  const weekday = weekdayLabel(entry, t);
  const ruleType = typeof entry.parameters.ruleType === "string"
    ? t(`admin.rules.type.${entry.parameters.ruleType}`)
    : undefined;
  const params = typeof entry.parameters.params === "object" && entry.parameters.params !== null
    ? paramsLabel(entry.parameters.params as Record<string, unknown>, t)
    : undefined;
  const opensAt = typeof entry.parameters.opensAt === "string" ? shortTime(entry.parameters.opensAt) : undefined;
  const closesAt = typeof entry.parameters.closesAt === "string" ? shortTime(entry.parameters.closesAt) : undefined;
  return t(`audit.event.${entry.eventType}`, {
    ...entry.parameters,
    ...(weekday !== undefined ? { weekday } : {}),
    ...(ruleType !== undefined ? { ruleType } : {}),
    ...(params !== undefined ? { params } : {}),
    ...(opensAt !== undefined ? { opensAt } : {}),
    ...(closesAt !== undefined ? { closesAt } : {}),
    ...(context ? { context } : {})
  });
}

export function actorLabel(entry: AuditEntry, t: TFunction): string {
  if (!entry.actorAccountId) return t("audit.actor.system");
  return entry.actorUsername ?? entry.actorAccountId;
}

export function subjectLabel(entry: AuditEntry, t: TFunction): string {
  return entry.subjectName ?? weekdayLabel(entry, t) ?? entry.subjectId;
}
