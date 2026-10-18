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
        : entry.kind === "template" ? `/api/admin/message-templates/${entry.id}`
          : entry.kind === "import-source" ? `/api/admin/import/sources/${entry.id}` : `/api/bookings/${entry.id}`;

export const IMPORT_SOURCE_PREFIX = "acceptance-headerless-";

export function foreignImportSources(sources, entries) {
  const ours = new Set(entries.filter((entry) => entry.kind === "import-source").map((entry) => entry.id));
  return sources.filter((source) => source.sourceKey.startsWith(IMPORT_SOURCE_PREFIX) && !ours.has(source.id))
    .map((source) => source.sourceKey);
}

export function foreignWordings(templates, entries) {
  const ours = new Set(entries.filter((entry) => entry.kind === "template").map((entry) => entry.id));
  return templates.flatMap((template) => template.languages
    .filter((wording) => wording.own)
    .map((wording) => `${template.kind}/${wording.language}`))
    .filter((id) => !ours.has(id));
}

export const RETENTION_CATEGORIES = ["BOOKINGS", "FORMER_MEMBERS"];
export const RETENTION_BLOCK_REASONS = ["ADMINISTRATOR", "NAMED_IN_BOOKINGS", "ON_A_WAITING_LIST"];

// The first entry of a category holds the period from before the run, however often a run changed it since.
export function retentionRestorations(entries) {
  const first = new Map();
  for (const entry of entries) {
    if (entry.kind !== "retention-policy" || first.has(entry.id)) continue;
    if (!RETENTION_CATEGORIES.includes(entry.id)) throw new Error(`unknown retention category ${entry.id}`);
    first.set(entry.id, entry.before ?? null);
  }
  return [...first].map(([category, before]) => before === null
    ? { category, before, method: "DELETE", path: `/api/admin/retention/policies/${category}` }
    : { category, before, method: "PUT", path: `/api/admin/retention/policies/${category}`, body: { retainMonths: before } });
}

// A period the board did not set is answered without months; the run sets one that differs from it.
export const periodsOf = (policies) => Object.fromEntries(RETENTION_CATEGORIES.map((category) =>
  [category, policies.find((policy) => policy.category === category)?.retainMonths ?? null]));
export const differentPeriod = (before) => before === 1 ? 2 : 1;

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

// The run window reaches back past the no-show seeded two days ago and forward to the last lane day.
export function usagePeriod(today, laneDays, daysBack = 3) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || laneDays.length === 0) throw new Error(`no usage period from ${today} and ${laneDays.length} lane days`);
  const back = new Date(`${today}T00:00:00Z`);
  back.setUTCDate(back.getUTCDate() - daysBack);
  const last = [...laneDays].sort().at(-1);
  return { from: back.toISOString().slice(0, 10), to: last > today ? last : today };
}

// What would name a persona on a page: the full name as the roster writes it and the address.
export function personaIdentities(roster, usernames, emails) {
  const named = new Set(usernames);
  return [...new Set([
    ...roster.filter((entry) => entry.username && named.has(entry.username)).map((entry) => `${entry.firstName} ${entry.lastName}`),
    ...emails.filter((email) => typeof email === "string" && email.length > 0)
  ])];
}

const BACKUP_UNAVAILABLE = new Set(["NOT_CONFIGURED", "NOT_RECORDED"]);
const BACKUP_FAILING = new Set(["UNREADABLE", "RECORDED_IN_THE_FUTURE"]);

// Read from the overview's own answer, so a UAT that later records real backups needs no change here.
export function backupReadingProblems(backup, checkedAt) {
  if (backup.state === "OK") {
    if (backup.reason) return [`an ok backup names the reason ${backup.reason}`];
    if (!backup.completedAt || !Number.isInteger(backup.ageSeconds) || backup.ageSeconds < 0) {
      return ["an ok backup carries no completion time and age"];
    }
    const elapsed = (Date.parse(checkedAt) - Date.parse(backup.completedAt)) / 1000;
    if (elapsed < 0) return [`the backup completed at ${backup.completedAt}, after the check at ${checkedAt}`];
    if (Math.abs(elapsed - backup.ageSeconds) > 1) return [`an age of ${backup.ageSeconds} s does not follow from ${backup.completedAt} and ${checkedAt}`];
    return [];
  }
  const problems = [];
  if (backup.ageSeconds !== undefined && backup.ageSeconds !== null) problems.push("a backup that is not ok carries an age");
  if (BACKUP_UNAVAILABLE.has(backup.reason) && backup.state !== "UNAVAILABLE") problems.push(`${backup.reason} reads ${backup.state}, not UNAVAILABLE`);
  else if (BACKUP_FAILING.has(backup.reason) && backup.state !== "FAILING") problems.push(`${backup.reason} reads ${backup.state}, not FAILING`);
  else if (!BACKUP_UNAVAILABLE.has(backup.reason) && !BACKUP_FAILING.has(backup.reason)) problems.push(`a backup that is not ok names no known reason: ${backup.reason}`);
  return problems;
}

// An instance before dated periods answers no membershipCurrent; there a set type without an end is the membership.
export const holdsMembership = (entry) => entry.membershipCurrent ?? Boolean(entry.membershipTypeId && !entry.membershipEndedOn);

export const barsCourtBooking = (rules) => (rules ?? []).some((rule) => rule.ruleType === "NO_COURT_BOOKING");

const samePeriod = (a, b) => a.membershipTypeId === b.membershipTypeId && a.startedOn === b.startedOn && (a.endedOn ?? null) === (b.endedOn ?? null);
const periodBody = (period) => ({ membershipTypeId: period.membershipTypeId, startedOn: period.startedOn, endedOn: period.endedOn ?? null });

const endOf = (period) => period.endedOn ?? "9999-12-31";
const shrinks = (from, to) => to.startedOn >= from.startedOn && endOf(to) <= endOf(from);

// Removals, then periods giving up days, then the rest, so no write overlaps a period not yet put back.
export function periodRestorations(personId, before, now) {
  const path = `/api/admin/roster/${personId}/membership-periods`;
  const removals = now.filter((period) => !before.some((kept) => kept.id === period.id))
    .map((period) => ({ method: "DELETE", path: `${path}/${period.id}` }));
  const corrections = before.flatMap((period) => {
    const current = now.find((candidate) => candidate.id === period.id);
    return current && !samePeriod(current, period) ? [{ current, period }] : [];
  });
  const puts = [...corrections.filter(({ current, period }) => shrinks(current, period)),
    ...corrections.filter(({ current, period }) => !shrinks(current, period))]
    .map(({ period }) => ({ method: "PUT", path: `${path}/${period.id}`, body: periodBody(period) }));
  const posts = before.filter((period) => !now.some((candidate) => candidate.id === period.id))
    .map((period) => ({ method: "POST", path, body: periodBody(period) }));
  return [...removals, ...puts, ...posts];
}

export function periodSnapshots(entries) {
  const first = new Map();
  for (const entry of entries) {
    if (entry.kind === "membership-period" && !first.has(entry.id)) first.set(entry.id, entry.periods ?? []);
  }
  return [...first].map(([personId, periods]) => ({ personId, periods }));
}

// A period put back by POST carries a new id, so only the content is compared.
export const comparablePeriods = (periods) => periods
  .map(({ membershipTypeId, startedOn, endedOn }) => ({ membershipTypeId, startedOn, endedOn: endedOn ?? null }))
  .sort((a, b) => a.startedOn.localeCompare(b.startedOn) || endOf(a).localeCompare(endOf(b)));

// The journey moves the running period's start and books on lastDay, so the period has to hold until after it.
export function membershipPeriodProblems(periods, lastDay) {
  const running = periods.filter((period) => period.state === "RUNNING");
  const scheduled = periods.filter((period) => period.state === "SCHEDULED");
  const problems = [];
  if (scheduled.length) problems.push(`holds a period scheduled from ${scheduled.map((period) => period.startedOn).join(", ")}, as an interrupted run of the membership period journey leaves it; correct it on the person page to a start on or before today, which unblocks the member`);
  if (running.length === 0) problems.push("holds no membership period running today");
  for (const period of running) {
    if (period.endedOn && period.endedOn <= lastDay) problems.push(`holds a running period that ends on ${period.endedOn}, not after ${lastDay}`);
  }
  return problems;
}
