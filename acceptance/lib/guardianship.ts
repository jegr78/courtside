import { adminDelete, type Api } from "./api";
import { readLedger } from "./ledger";
import { removalPath } from "./core.mjs";

// One profile: the dependant is that profile's disposable member, and the slot is the membership period journey's.
export const GUARDIAN_PROFILE = "desktop-chrome";

export type GuardianRelationship = { id: string; guardian: { personId: string }; dependant: { personId: string }; state: "RUNNING" | "ENDED" };

export async function readGuardianships(admin: Api, personId: string): Promise<GuardianRelationship[]> {
  return await (await admin.get(`/api/admin/roster/${personId}/guardianships`)).json() as GuardianRelationship[];
}

// An answer of 404 means the journey already removed it.
export async function removeGuardianships(admin: Api) {
  const outcome: { id: string; status: number }[] = [];
  for (const entry of readLedger().filter((candidate) => candidate.kind === "guardianship")) {
    outcome.push({ id: entry.id, status: (await adminDelete(admin, removalPath(entry))).status() });
  }
  return outcome;
}
