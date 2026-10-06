export function resourceDatePlan(snapshot, clock) {
  const rows = snapshot?.tables?.club_config?.rows;
  if (!Number.isSafeInteger(clock) || clock < 0 || !Array.isArray(rows) || rows.length !== 1
    || typeof rows[0].time_zone !== "string") throw new Error("The resource date plan lacks a clock or club zone");
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: rows[0].time_zone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
      weekday: "long" });
    const calendar = date => {
      const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
      return { startsOn: `${parts.year}-${parts.month}-${parts.day}`,
        startTime: `${parts.hour}:${parts.minute}:${parts.second}`, weekday: parts.weekday.toUpperCase() };
    };
    const slots = Object.fromEntries([3, 4, 5, 6].map(day => {
      const start = new Date(clock + day * 86400000);
      start.setUTCHours(16, 0, 0, 0);
      const end = new Date(start.getTime() + 3600000);
      return [day, { startsAt: start.toISOString(), endsAt: end.toISOString(), ...calendar(start) }];
    }));
    return { clock, timeZone: rows[0].time_zone, slots,
      seriesStartsOn: calendar(new Date(clock + 30 * 86400000)).startsOn };
  } catch {
    throw new Error("The resource date plan has an unsupported clock or club zone");
  }
}
