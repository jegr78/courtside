import { expect, it } from "vitest";
import type { SessionStatus } from "../api/client";
import { reachesAdministration, readsAccessCodes, readsGuestFees } from "./administrationAccess";

function session(roles: string[]): SessionStatus {
  return { authenticated: true, username: "roe.john", displayName: "John Roe", roles,
    passwordChangeRequired: false, managesAppointments: false, createsSeries: false } as SessionStatus;
}

it("given a treasurer, when administration is judged, then they reach it for the guest fees", () => {
  // when / then
  expect(reachesAdministration(session(["MEMBER", "TREASURER"]))).toBe(true);
  expect(readsGuestFees(session(["MEMBER", "TREASURER"]))).toBe(true);
});

it("given a member, when administration is judged, then neither administration nor guest fees are in reach", () => {
  // when / then
  expect(reachesAdministration(session(["MEMBER"]))).toBe(false);
  expect(readsGuestFees(session(["MEMBER"]))).toBe(false);
  expect(readsAccessCodes(session(["MEMBER", "TREASURER"]))).toBe(false);
});

it("given a groundskeeper, when administration is judged, then they reach it for the door codes and nothing of the treasury", () => {
  // when / then
  expect(reachesAdministration(session(["MEMBER", "GROUNDSKEEPER"]))).toBe(true);
  expect(readsAccessCodes(session(["MEMBER", "GROUNDSKEEPER"]))).toBe(true);
  expect(readsGuestFees(session(["MEMBER", "GROUNDSKEEPER"]))).toBe(false);
});
