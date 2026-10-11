const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

export function localDate(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const part = (type) => parts.find((candidate) => candidate.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(date, days) {
  const moved = new Date(`${date}T12:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

export const weekdayOf = (date) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

export function defaultWindowStart(now, timeZone) {
  let day = addDays(localDate(now, timeZone), 1);
  while (weekdayOf(day) !== "MONDAY") day = addDays(day, 1);
  return day;
}

export function resolveWindowStart(configured, now, timeZone) {
  if (configured === undefined) return defaultWindowStart(now, timeZone);
  const today = localDate(now, timeZone);
  if (configured <= today) throw new Error(`window.start ${configured} is not after the club's today ${today}`);
  return configured;
}

export const windowDays = (start) => Array.from({ length: 7 }, (_, index) => addDays(start, index));

const offsetMinutes = (instant, timeZone) => {
  const name = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" }).formatToParts(instant)
    .find((part) => part.type === "timeZoneName").value;
  const match = /GMT(?:([+-])(\d{2}):(\d{2}))?/.exec(name);
  return match[1] ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
};

export function zonedInstant(date, time, timeZone) {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const first = wall - offsetMinutes(new Date(wall), timeZone) * 60_000;
  return new Date(wall - offsetMinutes(new Date(first), timeZone) * 60_000);
}

export const hourOf = (time) => Number(time.slice(0, 2)) + (Number(time.slice(3, 5)) > 0 ? 1 : 0);
export const hh = (hour) => `${String(hour).padStart(2, "0")}:00`;
