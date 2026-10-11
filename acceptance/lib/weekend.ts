import { adminPut, apiAs } from "./api";
import { precondition } from "./precondition";
import { addDays, localDate } from "../config/calendar.mjs";
import { weekInForce } from "../config/lanes.mjs";
import { weeksToClear } from "./core.mjs";
import { lanePlan } from "./lanes";
import { readLedger, recordCreated } from "./ledger";
import { projectName } from "./journey";

const ownWeeks = () => new Set(readLedger().filter((entry) => entry.kind === "opening-week").map((entry) => entry.id));

export async function clearWeekend(): Promise<{ removed: string[]; foreign: string[] }> {
  const admin = await apiAs("admin");
  const weeks = await (await admin.get("/api/admin/opening-hours/schedule")).json() as { effectiveFrom: string | null }[];
  const today = localDate(new Date(), lanePlan().timeZone);
  const scheduled = weeks.slice(1).map((w) => w.effectiveFrom).filter((d): d is string => d !== null && d > today);
  const { remove, foreign } = weeksToClear({ scheduled, ours: ownWeeks() });
  for (const date of remove) {
    const removed = await admin.del(`/api/admin/opening-hours/schedule/${date}`);
    precondition(removed.ok() || removed.status() === 404, `removing the week from ${date} answered ${removed.status()}`);
  }
  return { removed: remove, foreign };
}

export const recordWeek = (effectiveFrom: string) => recordCreated({ kind: "opening-week", id: effectiveFrom, project: projectName() });

// A week ends where the next one starts, so the hours in force from the next day bound a test week to one day.
export async function boundWeek(effectiveFrom: string) {
  const admin = await apiAs("admin");
  const next = addDays(effectiveFrom, 1);
  const grid = await (await admin.get("/api/public/booking-grid")).json();
  const saved = await adminPut(admin, "/api/admin/opening-hours", { effectiveFrom: next, days: weekInForce(grid, next) });
  precondition(saved.ok(), `scheduling the hours in force from ${next} answered ${saved.status()}`);
  recordWeek(next);
}
