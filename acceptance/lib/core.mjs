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
