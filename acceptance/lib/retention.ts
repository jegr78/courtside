import { adminDelete, adminPut, type Api } from "./api";
import { readLedger } from "./ledger";
import { precondition } from "./precondition";
import { periodsOf, retentionRestorations } from "./core.mjs";

export type Periods = Record<"BOOKINGS" | "FORMER_MEMBERS", number | null>;

export async function readPeriods(admin: Api): Promise<Periods> {
  const answer = await admin.get("/api/admin/retention/policies");
  precondition(answer.ok(), `the admin reads the retention periods (answered ${answer.status()})`);
  return periodsOf(await answer.json()) as Periods;
}

// Puts back the period each category had before the run, as its first ledger entry recorded it.
export async function restorePeriods(admin: Api) {
  const outcome: { category: string; before: number | null; status: number }[] = [];
  for (const restoration of retentionRestorations(readLedger()) as { category: string; before: number | null; method: string; path: string; body?: unknown }[]) {
    const answer = restoration.method === "DELETE"
      ? await adminDelete(admin, restoration.path)
      : await adminPut(admin, restoration.path, restoration.body);
    outcome.push({ category: restoration.category, before: restoration.before, status: answer.status() });
  }
  return outcome;
}
