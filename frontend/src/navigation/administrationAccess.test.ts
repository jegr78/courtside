import { expect, it } from "vitest";
import type { SessionStatus } from "../api/client";
import { reachesAdministration, readsDoorCodes, readsGuestFees } from "./administrationAccess";

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
});

it("given a groundskeeper, when administration is judged, then they reach it for the door codes and not the guest fees", () => {
  // when / then
  expect(reachesAdministration(session(["MEMBER", "GROUNDSKEEPER"]))).toBe(true);
  expect(readsDoorCodes(session(["MEMBER", "GROUNDSKEEPER"]))).toBe(true);
  expect(readsGuestFees(session(["MEMBER", "GROUNDSKEEPER"]))).toBe(false);
});

it("given a treasurer or a member, when the door codes are judged, then neither reads them", () => {
  // when / then
  expect(readsDoorCodes(session(["MEMBER", "TREASURER"]))).toBe(false);
  expect(readsDoorCodes(session(["MEMBER"]))).toBe(false);
  expect(readsDoorCodes(session(["MEMBER", "ADMIN"]))).toBe(true);
});
