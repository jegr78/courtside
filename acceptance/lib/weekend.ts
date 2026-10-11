import { apiAs } from "./api";
import { precondition } from "./precondition";
import { localDate } from "../config/calendar.mjs";
import { lanePlan } from "./lanes";

// Every week scheduled after today is the harness's: preflight proves none exists before the run.
export async function clearWeekend(): Promise<string[]> {
  const admin = await apiAs("admin");
  try {
    const weeks = await (await admin.get("/api/admin/opening-hours/schedule")).json() as { effectiveFrom: string | null }[];
    const today = localDate(new Date(), lanePlan().timeZone);
    const ours = weeks.slice(1).map((w) => w.effectiveFrom).filter((d): d is string => d !== null && d > today);
    for (const date of ours) {
      const removed = await admin.del(`/api/admin/opening-hours/schedule/${date}`);
      precondition(removed.ok() || removed.status() === 404, `removing the week from ${date} answered ${removed.status()}`);
    }
    return ours;
  } finally { await admin.dispose(); }
}
