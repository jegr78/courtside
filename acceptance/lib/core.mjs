const LEVEL = /\b(ERROR|WARN|error|warn|Exception|Caused by)\b/;
const STAMP = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/;

export function occupying(allocations, courtId, from, to) {
  if (!Array.isArray(allocations)) throw new Error(`expected allocations, the instance answered ${JSON.stringify(allocations).slice(0, 200)}`);
  return [...new Set(allocations
    .filter((a) => a.courtId === courtId && Date.parse(a.startsAt) < to.getTime() && Date.parse(a.endsAt) > from.getTime())
    .map((a) => a.bookingId))];
}

export const removalPath = (entry) => entry.kind === "series"
  ? `/api/booking-series/${entry.id}?scope=WHOLE_SERIES${entry.anchor ? `&fromBookingId=${entry.anchor}` : ""}`
  : entry.kind === "opening-week" ? `/api/admin/opening-hours/schedule/${entry.id}`
    : entry.kind === "opening-period" ? `/api/admin/opening-periods/${entry.id}`
      : entry.kind === "court-closure" ? `/api/admin/court-closures/${entry.id}`
        : entry.kind === "template" ? `/api/admin/message-templates/${entry.id}` : `/api/bookings/${entry.id}`;

export function foreignWordings(templates, entries) {
  const ours = new Set(entries.filter((entry) => entry.kind === "template").map((entry) => entry.id));
  return templates.flatMap((template) => template.languages
    .filter((wording) => wording.own)
    .map((wording) => `${template.kind}/${wording.language}`))
    .filter((id) => !ours.has(id));
}

// The window sweep reads only the lane days, so a booking made further ahead is cancelled by its ledger entry.
export const bookingsBeyondWindow = (entries, days) =>
  entries.filter((entry) => entry.kind === "booking" && entry.date && !days.includes(entry.date));

export async function replayEntries(entries, remove) {
  const results = [];
  for (const entry of entries) {
    const status = (await remove(removalPath(entry))).status();
    results.push({ ...entry, status, outcome: status < 300 ? "cancelled" : status === 404 || status === 409 || status === 410 ? "gone" : "failed" });
  }
  return results;
}

export function classify(message = "") {
  if (message.includes("PRECONDITION: ")) return "precondition";
  if (/(^|\n|Error: )product: /.test(message)) return "product";
  return "harness";
}

// A timeout outranks the assertion it interrupted; otherwise the first error is the cause and later ones are teardown echoes.
export function classifyErrors(messages = []) {
  if (messages.some((m) => m.includes("Test timeout of"))) return "harness";
  return messages.length ? classify(messages[0]) : "harness";
}

const instant = (line) => {
  const match = line.match(STAMP);
  if (!match) return NaN;
  return Date.parse(`${match[1]}${(match[2] ?? "").slice(0, 4)}${match[3] ?? "Z"}`);
};

export function attribute(lines, steps) {
  return lines.filter((line) => LEVEL.test(line)).map((line) => {
    const at = instant(line);
    const hits = steps.filter((s) => at >= Date.parse(s.start) - 500 && at <= Date.parse(s.end) + 500)
      .map(({ project, persona, name }) => ({ project, persona, name }));
    return { at: Number.isNaN(at) ? null : new Date(at).toISOString(), line: line.slice(0, 600), level: line.match(LEVEL)[1], steps: hits, ambiguous: hits.length > 1 };
  });
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The instance answers a burst or a busy password check with 429; a refused call changed nothing, so it is sent again.
export async function admitted(call, sleep = pause) {
  for (let attempt = 1; ; attempt++) {
    const response = await call();
    if (response.status() !== 429 || attempt === 5) return response;
    await sleep(1000 * Math.max(1, Number(response.headers()["retry-after"] ?? 1)));
  }
}

// Only bookings in the run's ledger are cancelled; anything else in a reserved slot belongs to the club.
export async function sweepSlots({ slots, read, cancel, ours }) {
  const removed = [], left = [], foreign = [];
  for (const slot of slots) {
    for (const id of await read(slot)) {
      if (ours.has(id)) removed.push({ journey: slot.journey, id, status: await cancel(id) });
      else foreign.push({ journey: slot.journey, id });
    }
    left.push(...(await read(slot)).filter((id) => ours.has(id)).map((id) => ({ journey: slot.journey, id })));
  }
  return { removed, left, foreign };
}

export function weeksToClear({ scheduled, ours }) {
  return { remove: scheduled.filter((date) => ours.has(date)), foreign: scheduled.filter((date) => !ours.has(date)) };
}

export function answers(method, path) {
  return (response) => {
    if (response.request().method() !== method) return false;
    const { pathname } = new URL(response.url());
    return typeof path === "string" ? pathname === path : path.test(pathname);
  };
}

export function leavesBookingHours(slot, hours) {
  return slot.start < hours.earliestStart.slice(0, 5) || slot.end > hours.latestEnd.slice(0, 5);
}

// A run books several lanes per persona in one week, so any weekly limit on a lane persona can refuse a later lane.
export function laneLimitConflicts(eligibilityByPersona, laneMinutes) {
  return Object.entries(eligibilityByPersona).flatMap(([key, eligibility]) => [
    ...(eligibility.maxWeeklyBookedHours ? [`${key}: at most ${eligibility.maxWeeklyBookedHours} h a week`] : []),
    ...(eligibility.minBookingMinutes > laneMinutes ? [`${key}: at least ${eligibility.minBookingMinutes} minutes per booking`] : [])
  ]);
}

export function limitRefusals(limits, slotMinutes) {
  const { maxWeeklyBookedHours, minBookingMinutes } = limits;
  if (!maxWeeklyBookedHours || !minBookingMinutes || minBookingMinutes <= slotMinutes) return null;
  return { shortMinutes: slotMinutes, longMinutes: maxWeeklyBookedHours * 60 + slotMinutes };
}

const PERSON_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Courtside has no erasure path yet, so the accounts a run created to read its welcome are removed in the database.
export function welcomeErasureSql(personIds) {
  if (personIds.length === 0) return null;
  for (const id of personIds) if (!PERSON_ID.test(id)) throw new Error(`not a person id: ${id}`);
  const ids = personIds.map((id) => `'${id}'`).join(", ");
  return `BEGIN;
CREATE TEMP TABLE erased ON COMMIT DROP AS
  SELECT p.id AS person_id FROM person p LEFT JOIN user_account ua ON ua.person_id = p.id
  WHERE p.id IN (${ids}) AND p.email LIKE 'acceptance-welcome-%'
    AND (ua.id IS NULL OR (ua.username LIKE 'acceptance-welcome-%' AND NOT ua.enabled))
    AND NOT EXISTS (SELECT 1 FROM booking b WHERE b.booked_by = ua.id)
    AND NOT EXISTS (SELECT 1 FROM member m WHERE m.person_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM booking_participant bp WHERE bp.person_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM waitlist_participant wp WHERE wp.person_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM import_external_reference e WHERE e.person_id = p.id);
DELETE FROM user_account WHERE person_id IN (SELECT person_id FROM erased);
DELETE FROM person WHERE id IN (SELECT person_id FROM erased);
SELECT 'erased ' || count(*) FROM erased;
COMMIT;
`;
}

const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/;

export function waitlistErasureSql(usernames) {
  if (usernames.length === 0) return null;
  for (const name of usernames) if (!USERNAME.test(name)) throw new Error(`not a username: ${name}`);
  const names = usernames.map((name) => `'${name}'`).join(", ");
  return `BEGIN;
CREATE TEMP TABLE erased ON COMMIT DROP AS
  SELECT w.id FROM waitlist_entry w JOIN user_account ua ON ua.id = w.account_id
  WHERE ua.username IN (${names}) AND w.state NOT IN ('WAITING', 'OFFERED');
DELETE FROM waitlist_entry WHERE id IN (SELECT id FROM erased);
SELECT 'erased ' || count(*) FROM erased;
COMMIT;
`;
}

export const NO_SHOW_SEED_NOTE = "acceptance no-show seed";
const MEMBER_CARD = "11111111-1111-1111-1111-111111111111";

const usernameList = (usernames) => {
  for (const name of usernames) if (!USERNAME.test(name)) throw new Error(`not a username: ${name}`);
  return usernames.map((name) => `'${name}'`).join(", ");
};

// The product writes no booking in the past, so the started booking a no-show needs is seeded at night two days ago.
export function startedBookingSql(username, minuteOffset) {
  const names = usernameList([username]);
  if (!Number.isInteger(minuteOffset) || minuteOffset < 0 || minuteOffset > 170) throw new Error(`not a minute offset: ${minuteOffset}`);
  return `BEGIN;
CREATE TEMP TABLE seeded ON COMMIT DROP AS
  SELECT gen_random_uuid() AS id, ua.id AS account_id,
         ((current_date - 2)::timestamp + time '02:00' + interval '${minuteOffset} minutes')
           AT TIME ZONE (SELECT time_zone FROM club_config LIMIT 1) AS starts_at
  FROM user_account ua WHERE ua.username IN (${names});
INSERT INTO booking (id, card_id, status, booked_by, note, created_at)
  SELECT id, '${MEMBER_CARD}', 'CONFIRMED', account_id, '${NO_SHOW_SEED_NOTE}', starts_at - interval '1 day' FROM seeded;
INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status)
  SELECT gen_random_uuid(), id, (SELECT id FROM court WHERE active ORDER BY number LIMIT 1), starts_at, starts_at + interval '5 minutes', 'CONFIRMED'
  FROM seeded;
SELECT 'seeded ' || id FROM seeded;
COMMIT;
`;
}

export function seededBookingId(output) {
  return /^seeded ([0-9a-f-]{36})$/m.exec(output)?.[1] ?? null;
}

// Lifting a no-show keeps it recorded, so a run removes what it recorded and the bookings it seeded.
export function attendanceErasureSql(usernames) {
  if (usernames.length === 0) return null;
  const names = usernameList(usernames);
  return `BEGIN;
CREATE TEMP TABLE held ON COMMIT DROP AS
  SELECT b.id FROM booking b JOIN user_account ua ON ua.id = b.booked_by WHERE ua.username IN (${names});
CREATE TEMP TABLE erased ON COMMIT DROP AS
  SELECT booking_id FROM booking_attendance WHERE booking_id IN (SELECT id FROM held);
DELETE FROM booking_attendance WHERE booking_id IN (SELECT booking_id FROM erased);
DELETE FROM booking_release WHERE booking_id IN (SELECT id FROM held);
DELETE FROM booking WHERE id IN (SELECT id FROM held) AND note = '${NO_SHOW_SEED_NOTE}';
SELECT 'erased ' || count(*) FROM erased;
COMMIT;
`;
}

export function noShowLimitOf(rules) {
  const rule = (rules ?? []).find((candidate) => candidate.ruleType === "NO_SHOW_LIMIT");
  return rule ? { maxNoShows: rule.params.maxNoShows, windowDays: rule.params.windowDays } : null;
}

export const violationCodes = (body) => (body?.violations ?? []).map((violation) => violation.code);

// ssh hands the remote shell one string, so the command is quoted here; the container name holds no shell character.
export function erasureCommand({ ssh, container }) {
  return ["ssh", ["-o", "BatchMode=yes", "--", ssh,
    `docker exec -i ${container} sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'`]];
}

export function deactivationLeftover(answers) {
  return answers.filter((answer) => answer.status >= 300 && answer.type !== "urn:courtside:error:account-not-found");
}

export function erasedCount(output) {
  const match = /^erased (\d+)$/m.exec(output);
  return match ? Number(match[1]) : null;
}
