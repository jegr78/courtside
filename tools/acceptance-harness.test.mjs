import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const json = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

test("given the acceptance package, when its browser dependencies are read, then they equal the frontend's pins", () => {
  // given
  const acceptance = json("acceptance/package.json");
  const frontend = json("frontend/package.json");
  // when
  const pins = ["@playwright/test", "@axe-core/playwright"].map((name) =>
    [acceptance.dependencies?.[name], frontend.devDependencies?.[name] ?? frontend.dependencies?.[name]]);
  // then
  for (const [own, theirs] of pins) assert.equal(own, theirs, "acceptance pins the frontend's exact version");
});

import { ConfigError, parseConfig, PERSONA_KEYS } from "../acceptance/config/schema.mjs";

const valid = () => ({
  baseUrl: "https://club.example.org",
  expectedVersion: "1.2.3-rc.4",
  personas: Object.fromEntries(PERSONA_KEYS.map((key) => [key, `jane.${key.toLowerCase()}`]))
});
const env = { ACCEPTANCE_PASSWORD: "placeholder-secret" };
const field = (raw, environment = env) => {
  try { parseConfig(raw, environment); } catch (error) { assert.ok(error instanceof ConfigError, error.message); return error.field; }
  return null;
};

test("given a minimal configuration, when parsed, then defaults are filled and the password comes from the environment", () => {
  // when
  const config = parseConfig(valid(), env);
  // then
  assert.equal(config.password, "placeholder-secret");
  assert.equal(config.loadLimit, 5.5);
  assert.deepEqual(config.window, {});
  assert.deepEqual(config.logs, {});
});

test("given a configuration without baseUrl, when parsed, then the refusal names the field", () => {
  // given
  const raw = valid(); delete raw.baseUrl;
  // when / then
  assert.equal(field(raw), "baseUrl");
});

test("given no password in the environment, when parsed, then the refusal names ACCEPTANCE_PASSWORD", () => {
  // when / then
  assert.equal(field(valid(), {}), "ACCEPTANCE_PASSWORD");
});

test("given two actors with one username, when parsed, then the refusal names the second actor", () => {
  // given
  const raw = valid(); raw.personas.memberB = raw.personas.memberA;
  // when / then
  assert.equal(field(raw), "personas.memberB");
});

test("given a missing actor, when parsed, then the refusal names it", () => {
  // given
  const raw = valid(); delete raw.personas.grounds;
  // when / then
  assert.equal(field(raw), "personas.grounds");
});

test("given a window start that is not a Monday, when parsed, then the refusal names window.start", () => {
  // given
  const raw = { ...valid(), window: { start: "2030-01-02" } };
  // when / then
  assert.equal(field(raw), "window.start");
});

test("given fewer than two courts or a repeated court, when parsed, then the refusal names courts", () => {
  // when / then
  assert.equal(field({ ...valid(), courts: [1] }), "courts");
  assert.equal(field({ ...valid(), courts: [1, 1] }), "courts");
});

test("given an unknown time zone, an unknown key or a non-websocket Firefox endpoint, when parsed, then each is refused by name", () => {
  // when / then
  assert.equal(field({ ...valid(), timeZone: "Mars/Olympus" }), "timeZone");
  assert.equal(field({ ...valid(), baseURL: "https://club.example.org" }), "baseURL");
  assert.equal(field({ ...valid(), browsers: { firefox: { wsEndpoint: "http://127.0.0.1:1" } } }), "browsers.firefox.wsEndpoint");
});

test("given the example configuration, when parsed, then it is valid", () => {
  // given
  const example = JSON.parse(readFileSync(new URL("../acceptance/config.example.json", import.meta.url), "utf8"));
  // when / then
  assert.doesNotThrow(() => parseConfig(example, env));
});

import { addDays, defaultWindowStart, localDate, resolveWindowStart, windowDays, weekdayOf, zonedInstant } from "../acceptance/config/calendar.mjs";

test("given an instant after UTC midnight's eve, when the club day is read in a zone ahead of UTC, then it is the club's next day", () => {
  // given
  const lateEvening = new Date(Date.UTC(2030, 2, 3, 23, 30));
  // when / then
  assert.equal(localDate(lateEvening, "UTC"), "2030-03-03");
  assert.equal(localDate(lateEvening, "Europe/Berlin"), "2030-03-04");
});

test("when the default window is asked for on each weekday, then it starts on the first Monday after today", () => {
  // when / then
  assert.equal(defaultWindowStart(new Date(Date.UTC(2030, 2, 6, 12)), "UTC"), "2030-03-11");
  assert.equal(defaultWindowStart(new Date(Date.UTC(2030, 2, 10, 12)), "UTC"), "2030-03-11");
  assert.equal(defaultWindowStart(new Date(Date.UTC(2030, 2, 11, 12)), "UTC"), "2030-03-18");
});

test("given a configured start on today or earlier, when resolved, then it is refused by name, and a later Monday is kept", () => {
  // given
  const now = new Date(Date.UTC(2030, 2, 11, 12));
  // when / then
  assert.throws(() => resolveWindowStart("2030-03-11", now, "UTC"), /window\.start/);
  assert.equal(resolveWindowStart("2030-03-25", now, "UTC"), "2030-03-25");
  assert.equal(resolveWindowStart(undefined, now, "UTC"), "2030-03-18");
});

test("when a window is laid out, then it holds seven consecutive days from Monday to Sunday across a month end", () => {
  // when
  const days = windowDays("2030-04-29");
  // then
  assert.deepEqual(days, ["2030-04-29", "2030-04-30", "2030-05-01", "2030-05-02", "2030-05-03", "2030-05-04", "2030-05-05"]);
  assert.deepEqual([weekdayOf(days[0]), weekdayOf(days[6])], ["MONDAY", "SUNDAY"]);
  assert.equal(addDays("2030-12-31", 1), "2031-01-01");
});

test("given a week that ends with the change from summer time, when local hours become instants, then each keeps its local hour", () => {
  // when
  const saturday = zonedInstant("2026-10-24", "10:00", "Europe/Berlin");
  const sunday = zonedInstant("2026-10-25", "10:00", "Europe/Berlin");
  // then
  assert.equal(saturday.toISOString(), "2026-10-24T08:00:00.000Z");
  assert.equal(sunday.toISOString(), "2026-10-25T09:00:00.000Z");
});
