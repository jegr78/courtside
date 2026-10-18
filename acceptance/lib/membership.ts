import { adminDelete, adminPost, adminPut, type Api } from "./api";
import { readLedger } from "./ledger";
import { precondition } from "./precondition";
import { periodRestorations, periodSnapshots } from "./core.mjs";

// One profile: the periods belong to one disposable member, and the booking day is shared with the closure notice.
export const PERIOD_PROFILE = "desktop-chrome";

export type MembershipPeriod = { id: string; membershipTypeId: string; startedOn: string; endedOn: string | null; state: "RUNNING" | "SCHEDULED" | "ENDED" };

export async function readMembershipPeriods(admin: Api, personId: string): Promise<MembershipPeriod[]> {
  const answer = await admin.get(`/api/admin/roster/${personId}/membership-periods`);
  precondition(answer.ok(), `the admin reads the membership periods of ${personId} (answered ${answer.status()})`);
  return await answer.json() as MembershipPeriod[];
}

// Puts back every period of each person as the first ledger entry recorded them.
export async function restoreMembershipPeriods(admin: Api) {
  const outcome: { personId: string; method: string; path: string; status: number }[] = [];
  for (const { personId, periods } of periodSnapshots(readLedger()) as { personId: string; periods: MembershipPeriod[] }[]) {
    const restorations = periodRestorations(personId, periods, await readMembershipPeriods(admin, personId)) as { method: string; path: string; body?: unknown }[];
    for (const restoration of restorations) {
      const answer = restoration.method === "DELETE" ? await adminDelete(admin, restoration.path)
        : restoration.method === "POST" ? await adminPost(admin, restoration.path, restoration.body)
          : await adminPut(admin, restoration.path, restoration.body);
      outcome.push({ personId, method: restoration.method, path: restoration.path, status: answer.status() });
    }
  }
  return outcome;
}
