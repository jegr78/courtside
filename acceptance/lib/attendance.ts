import type { Api } from "./api";
import { config, disposables } from "./context";
import { noShowLimitOf } from "./core.mjs";

export const personaUsernames = (): string[] =>
  [...new Set([...Object.values(config.personas).filter((name): name is string => typeof name === "string"), ...disposables])];

async function ruleSetOf(admin: Api, personId: string): Promise<string | null> {
  const entry = await (await admin.get(`/api/admin/roster/${personId}`)).json() as { membershipTypeId?: string | null; membershipEndedOn?: string | null };
  if (entry.membershipTypeId && !entry.membershipEndedOn) {
    return (await (await admin.get(`/api/admin/membership-types/${entry.membershipTypeId}`)).json() as { ruleSetId?: string | null }).ruleSetId ?? null;
  }
  return (await (await admin.get("/api/admin/config")).json() as { noMembershipTypeRuleSetId?: string | null }).noMembershipTypeRuleSetId ?? null;
}

export async function noShowLimitFor(admin: Api, personId: string): Promise<{ maxNoShows: number; windowDays: number } | null> {
  const ruleSetId = await ruleSetOf(admin, personId);
  return ruleSetId ? noShowLimitOf(await (await admin.get(`/api/admin/rule-sets/${ruleSetId}/rules`)).json()) : null;
}
