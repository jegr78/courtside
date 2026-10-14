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
  : entry.kind === "opening-week" ? `/api/admin/opening-hours/schedule/${entry.id}` : `/api/bookings/${entry.id}`;

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
