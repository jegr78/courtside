import type { TFunction } from "i18next";
import type { AuditEntry, DayOfWeek } from "../api/client";
import i18n from "../i18n";
import { formatBookingPeriod, formatClockTime } from "../time/clubZone";

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
  if (entry.eventType === "dataexchange.log.exported" && typeof entry.parameters.log === "string") {
    return entry.parameters.log;
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
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const opensAt = typeof entry.parameters.opensAt === "string" ? formatClockTime(entry.parameters.opensAt, locale) : undefined;
  const closesAt = typeof entry.parameters.closesAt === "string" ? formatClockTime(entry.parameters.closesAt, locale) : undefined;
  const kind = entry.eventType.startsWith("facility.openingPeriod.") && typeof entry.parameters.kind === "string"
    ? t(`admin.availability.kind.${entry.parameters.kind}`)
    : undefined;
  const outcome = typeof entry.parameters.outcome === "string"
    ? t(`managedAppointments.attendance.${entry.parameters.outcome}`)
    : undefined;
  return t(`audit.event.${entry.eventType}`, {
    ...entry.parameters,
    ...(weekday !== undefined ? { weekday } : {}),
    ...(ruleType !== undefined ? { ruleType } : {}),
    ...(params !== undefined ? { params } : {}),
    ...(opensAt !== undefined ? { opensAt } : {}),
    ...(closesAt !== undefined ? { closesAt } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(outcome !== undefined ? { outcome } : {}),
    ...(context ? { context } : {})
  });
}

export function actorLabel(entry: AuditEntry, t: TFunction): string {
  if (!entry.actorAccountId) return t("audit.actor.system");
  return entry.actorUsername ?? entry.actorAccountId;
}

// Named per type, because a booking-module event may concern something other than a booking.
const BOOKING_MODULE_SUBJECTS: Record<string, "booking" | "series" | "waitlistEntry" | "named"> = {
  "booking.booking.confirmed": "booking",
  "booking.booking.displaced": "booking",
  "booking.booking.reminderDue": "booking",
  "booking.booking.accessCodeChanged": "booking",
  "access.grant.installed": "booking",
  "access.grant.failing": "booking",
  "access.grant.retryRequested": "booking",
  "booking.booking.cancelled": "booking",
  "booking.participant.recorded": "booking",
  "booking.participant.withdrew": "booking",
  "booking.partner.joined": "booking",
  "booking.attendance.recorded": "booking",
  "booking.attendance.cleared": "booking",
  "booking.attendance.released": "booking",
  "booking.attendance.noShowsLifted": "named",
  "booking.attendance.policyChanged": "named",
  "booking.series.created": "series",
  "booking.series.cancelled": "series",
  "booking.series.moved": "series",
  "booking.waitlist.offered": "waitlistEntry"
};

function bookingSubjectLabel(entry: AuditEntry, kind: "booking" | "series", t: TFunction, language: string, timeZone: string): string {
  const period = entry.subjectPeriod;
  if (!period) return t(`audit.subject.${kind}Unresolved`, { subjectId: entry.subjectId });
  return t(`audit.subject.${kind}`, {
    courts: entry.subjectName ?? t("audit.subject.courtsUnknown"),
    period: formatBookingPeriod(period.startsAt, period.endsAt, language, timeZone)
  });
}

export function subjectLabel(entry: AuditEntry, t: TFunction, language: string, timeZone: string): string {
  if (!entry.subjectId) return t("audit.subject.instance");
  const kind = BOOKING_MODULE_SUBJECTS[entry.eventType];
  if (kind === "waitlistEntry") return entry.subjectName ?? t("audit.subject.waitlistEntry", { subjectId: entry.subjectId });
  if (kind === "booking" || kind === "series") return bookingSubjectLabel(entry, kind, t, language, timeZone);
  return entry.subjectName ?? weekdayLabel(entry, t) ?? entry.subjectId;
}
