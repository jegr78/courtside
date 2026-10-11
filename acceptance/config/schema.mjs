import { readFileSync } from "node:fs";

export const PERSONA_KEYS = ["admin", "trainer", "youth", "sport", "grounds", "treasurer", "memberA", "memberB", "memberC", "disposable"];
const TOP_LEVEL = ["baseUrl", "expectedVersion", "personas", "timeZone", "window", "courts", "mail", "logs", "metrics", "browsers", "loadLimit", "resetCodesPerHour", "notifyClubBookings"];

export class ConfigError extends Error {
  constructor(field, problem) {
    super(`acceptance configuration ${field}: ${problem}`);
    this.field = field;
  }
}

const object = (value, field) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ConfigError(field, "must be an object");
  return value;
};
const text = (value, field) => {
  if (typeof value !== "string" || value.trim() === "") throw new ConfigError(field, "must be a non-empty string");
  return value;
};
const url = (value, field, protocols) => {
  let parsed;
  try { parsed = new URL(text(value, field)); } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(field, "must be an absolute URL");
  }
  if (!protocols.includes(parsed.protocol)) throw new ConfigError(field, `must use ${protocols.join(" or ")}`);
  return value.replace(/\/$/, "");
};
const onlyKeys = (value, allowed, prefix) => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new ConfigError(prefix ? `${prefix}.${key}` : key, "is not a known field");
};

export function parseConfig(raw, env) {
  const input = object(raw, "configuration");
  onlyKeys(input, TOP_LEVEL, "");
  const config = {
    baseUrl: url(input.baseUrl, "baseUrl", ["https:", "http:"]),
    expectedVersion: text(input.expectedVersion, "expectedVersion"),
    personas: {},
    password: text(env.ACCEPTANCE_PASSWORD, "ACCEPTANCE_PASSWORD"),
    window: {},
    logs: {},
    browsers: {},
    loadLimit: 5.5,
    notifyClubBookings: false,
    resetCodesPerHour: 5
  };
  const personas = object(input.personas, "personas");
  onlyKeys(personas, PERSONA_KEYS, "personas");
  const seen = new Set();
  for (const key of PERSONA_KEYS) {
    const many = key === "disposable" && Array.isArray(personas[key]);
    if (many && personas[key].length === 0) throw new ConfigError("personas.disposable", "must name at least one account");
    const usernames = many ? personas[key].map((value) => text(value, "personas.disposable")) : [text(personas[key], `personas.${key}`)];
    for (const username of usernames) {
      if (seen.has(username)) throw new ConfigError(`personas.${key}`, "repeats another actor's username");
      seen.add(username);
    }
    config.personas[key] = usernames[0];
    if (key === "disposable") config.disposables = usernames;
  }
  if (input.timeZone !== undefined) {
    try { new Intl.DateTimeFormat("en", { timeZone: text(input.timeZone, "timeZone") }); } catch (error) {
      if (error instanceof ConfigError) throw error;
      throw new ConfigError("timeZone", "is not a known IANA time zone");
    }
    config.timeZone = input.timeZone;
  }
  if (input.window !== undefined) {
    const window = object(input.window, "window");
    onlyKeys(window, ["start"], "window");
    if (window.start !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(window.start) || new Date(`${window.start}T12:00:00Z`).getUTCDay() !== 1) {
        throw new ConfigError("window.start", "must be a date in the form YYYY-MM-DD that falls on a Monday");
      }
      config.window.start = window.start;
    }
  }
  if (input.courts !== undefined) {
    const courts = input.courts;
    if (!Array.isArray(courts) || courts.length < 2 || new Set(courts).size !== courts.length
      || !courts.every((court) => Number.isInteger(court) && court > 0)) {
      throw new ConfigError("courts", "must list at least two distinct positive court numbers");
    }
    config.courts = courts;
  }
  if (input.mail !== undefined) {
    const mail = object(input.mail, "mail");
    onlyKeys(mail, ["url"], "mail");
    config.mail = { url: url(mail.url, "mail.url", ["http:", "https:"]) };
  }
  if (input.logs !== undefined) {
    const logs = object(input.logs, "logs");
    onlyKeys(logs, ["app", "proxy"], "logs");
    for (const key of ["app", "proxy"]) if (logs[key] !== undefined) config.logs[key] = text(logs[key], `logs.${key}`);
  }
  if (input.metrics !== undefined) {
    const metrics = object(input.metrics, "metrics");
    onlyKeys(metrics, ["url"], "metrics");
    config.metrics = { url: url(metrics.url, "metrics.url", ["http:", "https:"]) };
  }
  if (input.browsers !== undefined) {
    const browsers = object(input.browsers, "browsers");
    onlyKeys(browsers, ["firefox"], "browsers");
    if (browsers.firefox !== undefined) {
      const firefox = object(browsers.firefox, "browsers.firefox");
      onlyKeys(firefox, ["wsEndpoint"], "browsers.firefox");
      config.browsers.firefox = { wsEndpoint: url(firefox.wsEndpoint, "browsers.firefox.wsEndpoint", ["ws:", "wss:"]) };
    }
  }
  if (input.loadLimit !== undefined) {
    if (typeof input.loadLimit !== "number" || !(input.loadLimit > 0)) throw new ConfigError("loadLimit", "must be a positive number");
    config.loadLimit = input.loadLimit;
  }
  if (input.resetCodesPerHour !== undefined) {
    if (!Number.isInteger(input.resetCodesPerHour) || input.resetCodesPerHour < 1) throw new ConfigError("resetCodesPerHour", "must be a positive whole number");
    config.resetCodesPerHour = input.resetCodesPerHour;
  }
  if (input.notifyClubBookings !== undefined) {
    if (typeof input.notifyClubBookings !== "boolean") throw new ConfigError("notifyClubBookings", "must be true or false");
    config.notifyClubBookings = input.notifyClubBookings;
  }
  return config;
}

export function loadConfig(env = process.env) {
  const path = text(env.ACCEPTANCE_CONFIG, "ACCEPTANCE_CONFIG");
  let raw;
  try { raw = JSON.parse(readFileSync(path, "utf8")); } catch {
    throw new ConfigError("ACCEPTANCE_CONFIG", `cannot read JSON from ${path}`);
  }
  return parseConfig(raw, env);
}
