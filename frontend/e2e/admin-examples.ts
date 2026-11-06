import { journeyInstant } from "./global-setup";

// One check in each state, because the journey instance never fails a check of its own.
export const operatorHealthExample = {
  checkedAt: "2026-10-17T08:00:00Z",
  version: { state: "OK", version: "0.4.0", revision: "4f2c9e1", builtAt: "2026-10-16T20:00:00Z" },
  migrations: { state: "OK", reason: null, pending: 0, currentVersion: "63", expectedVersion: "63", location: null },
  mail: { state: "FAILING", reason: "HANDOVER_FAILING", lastHandedOverAt: "2026-10-17T07:00:00Z", location: "relay.example.org:587" },
  publicOrigin: { state: "OK", reason: null, origin: "https://courts.example.org" },
  backup: { state: "UNAVAILABLE", reason: "NOT_CONFIGURED", completedAt: null, ageSeconds: null, location: null }
};

// A failing grant beside an installed one, because the simulated access-control system never fails.
export const connectionCheckExample = {
  checkedAt: "2026-05-14T08:00:00Z",
  checks: [
    { check: "miniserver", outcome: "PASSED", code: "access.check.miniserver.reached", params: { version: "16.1.10.3", minimum: "14.2.5.16" } },
    { check: "login", outcome: "PASSED", code: "access.check.login.accepted", params: {} },
    { check: "groups", outcome: "PASSED", code: "access.check.groups.mapped", params: { accessPoints: "North gate, South gate" } },
    { check: "probe-user", outcome: "PASSED", code: "access.check.probeUser.passed", params: {} },
    { check: "keypad", outcome: "MANUAL", code: "access.check.keypad.manual", params: {} }
  ]
};

export const accessGrantsExample = {
  connector: "loxone", connected: true, total: 2,
  probe: { reachable: true, outcome: "ANSWERED", detail: "", checkedAt: "2026-05-14T08:00:00Z" },
  grants: [
    {
      id: "00000000-0000-4000-8000-000000000001", bookingId: "example-failing", status: "FAILING",
      validFrom: "2026-05-14T15:45:00Z", validUntil: "2026-05-14T17:45:00Z",
      startsAt: "2026-05-14T16:00:00Z", endsAt: "2026-05-14T17:30:00Z",
      courts: [{ number: 3, name: "Court 3" }], accessPoints: ["North gate"],
      attempts: 5, lastFailure: "The keypad holds no free user slot", nextAttemptAt: null
    },
    {
      id: "00000000-0000-4000-8000-000000000002", bookingId: "example-installed", status: "INSTALLED",
      validFrom: "2026-05-15T08:45:00Z", validUntil: "2026-05-15T10:15:00Z",
      startsAt: "2026-05-15T09:00:00Z", endsAt: "2026-05-15T10:00:00Z",
      courts: [{ number: 1, name: "Court 1" }, { number: 2, name: "Court 2" }], accessPoints: ["North gate", "South gate"],
      attempts: 0, lastFailure: null, nextAttemptAt: null
    }
  ]
};

export const operationalLogExample = {
  availability: "AVAILABLE", retentionTruncated: false, searchIncomplete: false, droppedRecords: 0,
  entries: [{
    id: "7d000000-0000-0000-0000-000000000001", occurredAt: journeyInstant, source: "APPLICATION", severity: "WARN",
    message: "Mail relay relay.example.org refused the connection on port 587 and the message stays queued: 421 4.7.0 Try again later, "
      + "closing connection after 3 attempts within 15 minutes; the next attempt for <0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0@relay.example.org> "
      + "follows the exponential backoff of the outbox",
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736"
  }]
};

export const guestFeesExample = {
  from: "2026-01-01",
  to: "2026-12-31",
  sources: [{ id: "55555555-0000-0000-0000-000000000001", displayName: "Club registry" }],
  members: [
    { personId: "66666666-0000-0000-0000-000000000001", firstName: "Jane", lastName: "Doe",
      email: "jane.doe@example.org", memberNumbers: [{ sourceId: "55555555-0000-0000-0000-000000000001", externalId: "1017" }],
      currency: "EUR", guestPlaces: 5, sumMinor: 2500 },
    { personId: "66666666-0000-0000-0000-000000000002", firstName: "Mary", lastName: "Major",
      email: "mary.major@example.org", memberNumbers: [{ sourceId: "55555555-0000-0000-0000-000000000001", externalId: "1023" }],
      currency: "EUR", guestPlaces: 2, sumMinor: 1000 },
    { personId: "66666666-0000-0000-0000-000000000003", firstName: "John", lastName: "Roe",
      email: "john.roe@example.org", memberNumbers: [{ sourceId: "55555555-0000-0000-0000-000000000001", externalId: "1031" }],
      currency: "EUR", guestPlaces: 1, sumMinor: 500 }
  ],
  unassignedGuestPlaces: 1
};
