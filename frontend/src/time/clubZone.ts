export function zonedDateTime(date: string, time: string, timeZone: string): string {
  const wallClock = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set([
    offsetAt(new Date(wallClock - 86_400_000), timeZone),
    offsetAt(new Date(wallClock), timeZone),
    offsetAt(new Date(wallClock + 86_400_000), timeZone)
  ]);
  const match = [...offsets]
    .map((offset) => ({ instant: new Date(wallClock - offset), offset }))
    .filter(({ instant }) => localDateTime(instant, timeZone) === `${date}T${time}`)
    .sort((left, right) => left.instant.getTime() - right.instant.getTime())[0];
  if (!match) throw new RangeError(`The wall-clock time does not exist in ${timeZone}`);
  return `${date}T${time}:00${offsetLabel(match.offset)}`;
}

export function isValidZonedDateTime(date: string, time: string, timeZone: string): boolean {
  try {
    zonedDateTime(date, time, timeZone);
    return true;
  } catch (failure) {
    if (failure instanceof RangeError) return false;
    throw failure;
  }
}

export function bookingTimeSlot(date: string, time: string, timeZone: string, durationMinutes: number) {
  const startsAt = zonedDateTime(date, time, timeZone);
  const endsAt = new Date(Date.parse(startsAt) + durationMinutes * 60_000).toISOString();
  return { startsAt, endsAt };
}

function localDateTime(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

function offsetAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, timeZoneName: "longOffset", hour: "2-digit"
  }).formatToParts(instant);
  const label = parts.find((part) => part.type === "timeZoneName")?.value.replace("GMT", "") || "";
  if (!label) return 0;
  const [hours, minutes] = label.slice(1).split(":").map(Number);
  const magnitude = (hours * 60 + (minutes || 0)) * 60_000;
  return label.startsWith("-") ? -magnitude : magnitude;
}

function offsetLabel(offset: number): string {
  const sign = offset < 0 ? "-" : "+";
  const total = Math.abs(offset) / 60_000;
  const hours = String(Math.floor(total / 60)).padStart(2, "0");
  const minutes = String(total % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

export function dateInTimeZone(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(value("year"), value("month") - 1, value("day"));
}

export function dateInTimeZoneValue(instant: Date, timeZone?: string): string | undefined {
  return timeZone ? formatDate(dateInTimeZone(instant, timeZone)) : undefined;
}

export function shortTime(value: string | null | undefined): string {
  return value?.slice(0, 5) ?? "";
}

export function formatTime(timestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("hour")}:${value("minute")}`;
}

export function formatDateTime(timestamp: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone })
    .format(new Date(timestamp));
}

export function isPastSlot(date: string, time: string, timeZone: string, now: Date): boolean {
  return Date.parse(zonedDateTime(date, time, timeZone)) < now.getTime();
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

export function startOfWeek(date: Date): Date {
  return addDays(date, -((date.getDay() + 6) % 7));
}

export function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function calendarDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
