import type { DateTimeType } from "./DateTimeInput";

const normalize = (value: string) => value.replace(/[\u00a0\u202f]/g, " ").trim();
const pad = (value: number) => String(value).padStart(2, "0");

function formatter(locale: string, date: boolean, seconds = false) {
  return new Intl.DateTimeFormat(locale, date
    ? { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }
    : { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), timeZone: "UTC" });
}

function canonical(value: string, type: DateTimeType): boolean {
  const match = type === "date" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    : type === "time" ? /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value)
      : /^(\d{4}-\d{2}-\d{2})T(.+)$/.exec(value);
  if (!match) return false;
  if (type === "datetime-local") return canonical(match[1], "date") && canonical(match[2], "time");
  if (type === "time") return Number(match[1]) < 24 && Number(match[2]) < 60 && Number(match[3] ?? 0) < 60;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

export function formatDateTime(value: string, type: DateTimeType, locale: string): string {
  if (!canonical(value, type)) return value;
  if (type === "datetime-local") {
    const [date, time] = value.split("T");
    return `${formatDateTime(date, "date", locale)} ${formatDateTime(time, "time", locale)}`;
  }
  const date = new Date(0);
  if (type === "date") {
    const [year, month, day] = value.split("-").map(Number);
    date.setUTCFullYear(year, month - 1, day);
  } else {
    const [hour, minute, second = "0"] = value.split(":");
    date.setUTCHours(Number(hour), Number(minute), Number(second));
  }
  const fraction = value.includes(".") ? value.slice(value.indexOf(".")) : "";
  return normalize(formatter(locale, type === "date", value.split(":").length === 3).formatToParts(date)
    .map((part) => part.type === "year" ? part.value.padStart(4, "0") : part.type === "second" ? part.value + fraction : part.value).join(""));
}

function parsePart(value: string, locale: string, date: boolean): string | null {
  const parts = formatter(locale, date, !date && value.split(":").length === 3).formatToParts(new Date(Date.UTC(2026, 9, 3, 16, 5, 12)));
  const fields: string[] = [];
  const pattern = parts.map((part) => {
    if (part.type === "literal") return normalize(part.value) === "" ? "\\s+" : part.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    fields.push(part.type);
    return part.type === "dayPeriod" ? "(AM|PM)" : part.type === "year" ? "(\\d{4})" : part.type === "second" ? "(\\d{2}(?:\\.\\d{1,3})?)" : "(\\d{2})";
  }).join("");
  const match = new RegExp(`^${pattern}$`, "i").exec(value);
  if (!match) return null;
  const values = Object.fromEntries(fields.map((field, index) => [field, match[index + 1]]));
  if (date) return `${values.year}-${values.month}-${values.day}`;
  let hour = Number(values.hour);
  if (values.dayPeriod) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (values.dayPeriod.toUpperCase() === "PM" ? 12 : 0);
  }
  return `${pad(hour)}:${values.minute}${values.second ? `:${values.second}` : ""}`;
}

export function parseDateTime(value: string, type: DateTimeType, locale: string): string | null {
  const text = normalize(value);
  if (!text) return "";
  if (canonical(text, type)) return text;
  let parsed: string | null;
  if (type === "datetime-local") {
    const separator = text.indexOf(" ");
    const date = parsePart(text.slice(0, separator), locale, true);
    const time = parsePart(text.slice(separator + 1), locale, false);
    parsed = date && time ? `${date}T${time}` : null;
  } else parsed = parsePart(text, locale, type === "date");
  return parsed && canonical(parsed, type) ? parsed : null;
}

export function dateTimeNumber(value: string, type: DateTimeType): number {
  if (type === "time") {
    const [hour, minute, second = 0] = value.split(":").map(Number);
    return (hour * 3600 + minute * 60 + second) * 1000;
  }
  return Date.parse(`${value}${type === "date" ? "T00:00" : ""}Z`);
}
