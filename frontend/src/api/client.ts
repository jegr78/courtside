import type { components } from "./schema";

export type SessionStatus = components["schemas"]["SessionStatus"];
export type ClubConfig = components["schemas"]["ClubConfig"];
export type ClubConfigRequest = components["schemas"]["ClubConfigRequest"];
export type Impact = components["schemas"]["Impact"];
export type RuleSet = components["schemas"]["RuleSet"];
export type RuleSetRequest = components["schemas"]["RuleSetRequest"];
export type RuleType = components["schemas"]["RuleType"];
export type RuleTypeConfiguration = components["schemas"]["RuleTypeConfiguration"];
export type RuleDefinition = components["schemas"]["RuleDefinition"];
export type AdminCourt = components["schemas"]["Court"];
export type CourtRequest = components["schemas"]["CourtRequest"];
export type OpeningHours = components["schemas"]["OpeningHours"];
export type DayOfWeek = components["schemas"]["DayOfWeek"];
export type SetOpeningHoursRequest = components["schemas"]["SetOpeningHoursRequest"];
export type BookingCard = components["schemas"]["BookingCard"];
export type BookingCardRequest = components["schemas"]["BookingCardRequest"];
export type Role = components["schemas"]["Role"];
export type RosterEntry = components["schemas"]["RosterEntry"];
export type RosterPage = components["schemas"]["RosterPage"];
export type AuditEntry = components["schemas"]["AuditEntry"];
export type AuditPage = components["schemas"]["AuditPage"];
export type PersonRequest = components["schemas"]["PersonRequest"];
export type MembershipRequest = components["schemas"]["MembershipRequest"];
export type MembershipType = components["schemas"]["MembershipType"];
export type MembershipTypeRequest = components["schemas"]["MembershipTypeRequest"];
export type ImportSource = components["schemas"]["ImportSource"];
export type ImportSourceRequest = components["schemas"]["ImportSourceRequest"];
export type CanonicalField = components["schemas"]["CanonicalField"];
export type SnapshotMode = components["schemas"]["SnapshotMode"];
export type ImportChangeKind = components["schemas"]["ImportChangeKind"];
export type ImportPersonChange = components["schemas"]["ImportPersonChange"];
export type ImportRowError = components["schemas"]["ImportRowError"];
export type ImportPossibleDuplicate = components["schemas"]["ImportPossibleDuplicate"];
export type ImportRemovalCounts = components["schemas"]["ImportRemovalCounts"];
export type ImportPreview = components["schemas"]["ImportPreview"];
export type ImportRun = components["schemas"]["ImportRun"];
export type ExternalReference = components["schemas"]["ExternalReference"];
export type ExternalReferencePage = components["schemas"]["ExternalReferencePage"];
export type ExternalReferenceRequest = components["schemas"]["ExternalReferenceRequest"];
export type AccountRequest = components["schemas"]["AccountRequest"];
export type SourceOffer = components["schemas"]["SourceOffer"];
export type Problem = components["schemas"]["Problem"];
export type PublicCourt = components["schemas"]["PublicCourt"];
export type Allocation = components["schemas"]["Allocation"];
export type BookingGrid = components["schemas"]["BookingGrid"];
export type PublicBookingCard = components["schemas"]["PublicBookingCard"];
export type SeriesRuleRequest = components["schemas"]["SeriesRuleRequest"];
export type CreateSeriesRequest = components["schemas"]["CreateSeriesRequest"];
export type SeriesPreview = components["schemas"]["SeriesPreview"];
export type SeriesCreated = components["schemas"]["SeriesCreated"];
export type Occurrence = components["schemas"]["Occurrence"];
export type PublicParticipantCard = components["schemas"]["PublicParticipantCard"];
export type ParticipantCard = components["schemas"]["ParticipantCard"];
export type ParticipantCardRequest = components["schemas"]["ParticipantCardRequest"];
export type PublicParticipantMember = components["schemas"]["PublicParticipantMember"];
export type CreateBookingRequest = components["schemas"]["CreateBookingRequest"];
export type BookingCreated = components["schemas"]["BookingCreated"];
export type PersonalBooking = components["schemas"]["PersonalBooking"];
export type PersonalBookingPage = components["schemas"]["PersonalBookingPage"];
export type Participation = components["schemas"]["Participation"];
export type ParticipationPage = components["schemas"]["ParticipationPage"];
export type ManagedAppointment = components["schemas"]["ManagedAppointment"];
export type ManagedAppointmentPage = components["schemas"]["ManagedAppointmentPage"];
export type ManagedAppointmentDetail = components["schemas"]["ManagedAppointmentDetail"];
export type CancelScope = components["schemas"]["CancelScope"];
export type MoveRequest = components["schemas"]["MoveRequest"];
export type MovePreview = components["schemas"]["MovePreview"];
export type MoveExecuted = components["schemas"]["MoveExecuted"];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem?: Problem
  ) {
    super(problem?.type ?? `HTTP ${status}`);
  }
}

async function request<T>(path: string, init: RequestInit = {}, notifyUnauthorized = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET" && init.method !== "HEAD") {
    const token = csrfToken();
    if (token) {
      headers.set("X-XSRF-TOKEN", token);
    }
  }
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    const problem = response.headers.get("content-type")?.includes("application/problem+json")
      ? (await response.json()) as Problem
      : undefined;
    if (response.status === 401 && notifyUnauthorized) {
      window.dispatchEvent(new Event("courtside:unauthenticated"));
    }
    throw new ApiError(response.status, problem);
  }
  if (response.status === 204 || response.headers.get("Content-Length") === "0") {
    return undefined as T;
  }
  const body = await response.text();
  return body ? JSON.parse(body) as T : undefined as T;
}

function csrfToken(): string | undefined {
  const cookie = document.cookie.split("; ")
    .find((entry) => entry.startsWith("XSRF-TOKEN="));
  return cookie ? decodeURIComponent(cookie.substring("XSRF-TOKEN=".length)) : undefined;
}

export const api = {
  session: () => request<SessionStatus>("/api/session"),
  config: () => request<ClubConfig>("/api/public/config"),
  adminConfig: () => request<ClubConfig>("/api/admin/config"),
  changeAdminConfig: (config: ClubConfigRequest) => request<ClubConfig>("/api/admin/config", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config)
  }),
  ruleSets: () => request<RuleSet[]>("/api/admin/rule-sets"),
  createRuleSet: (ruleSet: RuleSetRequest) => request<RuleSet>("/api/admin/rule-sets", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ruleSet)
  }),
  changeRuleSet: (ruleSetId: string, ruleSet: RuleSetRequest) => request<RuleSet>(
    `/api/admin/rule-sets/${ruleSetId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ruleSet)
    }
  ),
  setRuleSetActive: (ruleSetId: string, active: boolean) => request<RuleSet>(
    `/api/admin/rule-sets/${ruleSetId}/active`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active })
    }
  ),
  removeRule: (ruleSetId: string, ruleType: RuleType) => request<void>(
    `/api/admin/rule-sets/${ruleSetId}/rules/${ruleType}`, { method: "DELETE" }
  ),
  ruleTypes: () => request<RuleTypeConfiguration[]>("/api/admin/rule-types"),
  rules: (ruleSetId: string) => request<RuleDefinition[]>(`/api/admin/rule-sets/${ruleSetId}/rules`),
  setRule: (ruleSetId: string, ruleType: RuleType, params: Record<string, number>) => request<RuleDefinition>(
    `/api/admin/rule-sets/${ruleSetId}/rules/${ruleType}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ params })
    }
  ),
  courtImpact: (courtId: string) => request<Impact>(`/api/admin/impact/courts/${courtId}`),
  bookingCardImpact: (cardId: string) => request<Impact>(`/api/admin/impact/booking-cards/${cardId}`),
  openingHoursImpact: (day: DayOfWeek, opensAt?: string, closesAt?: string) => request<Impact>(
    `/api/admin/impact/opening-hours/${day}?${new URLSearchParams({
      ...(opensAt ? { opensAt } : {}),
      ...(closesAt ? { closesAt } : {})
    }).toString()}`
  ),
  adminCourts: () => request<AdminCourt[]>("/api/admin/courts"),
  createAdminCourt: (court: CourtRequest) => request<AdminCourt>("/api/admin/courts", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(court)
  }),
  changeAdminCourt: (id: string, court: CourtRequest) => request<AdminCourt>(`/api/admin/courts/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(court)
  }),
  setAdminCourtActive: (id: string, active: boolean) => request<AdminCourt>(`/api/admin/courts/${id}/active`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active })
  }),
  adminOpeningHours: () => request<OpeningHours[]>("/api/admin/opening-hours"),
  setAdminOpeningHours: (day: DayOfWeek, hours: SetOpeningHoursRequest) => request<OpeningHours>(
    `/api/admin/opening-hours/${day}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(hours)
    }
  ),
  closeAdminDay: (day: DayOfWeek) => request<void>(`/api/admin/opening-hours/${day}`, { method: "DELETE" }),
  adminBookingCards: () => request<BookingCard[]>("/api/admin/booking-cards"),
  createAdminBookingCard: (card: BookingCardRequest) => request<BookingCard>("/api/admin/booking-cards", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card)
  }),
  changeAdminBookingCard: (id: string, card: BookingCardRequest) => request<BookingCard>(`/api/admin/booking-cards/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card)
  }),
  setAdminBookingCardActive: (id: string, active: boolean) => request<BookingCard>(`/api/admin/booking-cards/${id}/active`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active })
  }),
  adminParticipantCards: () => request<ParticipantCard[]>("/api/admin/participant-cards"),
  createParticipantCard: (card: ParticipantCardRequest) => request<ParticipantCard>("/api/admin/participant-cards", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card)
  }),
  changeParticipantCard: (id: string, card: ParticipantCardRequest) => request<ParticipantCard>(`/api/admin/participant-cards/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card)
  }),
  setParticipantCardActive: (id: string, active: boolean) => request<ParticipantCard>(`/api/admin/participant-cards/${id}/active`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active })
  }),
  roster: (query?: string, cursor?: string, limit = 50, membershipTypeId?: string) => request<RosterPage>(
    `/api/admin/roster?${new URLSearchParams({
      limit: String(limit),
      ...(query ? { query } : {}),
      ...(cursor ? { cursor } : {}),
      ...(membershipTypeId ? { membershipTypeId } : {})
    })}`
  ),
  person: (personId: string) => request<RosterEntry>(`/api/admin/roster/${personId}`),
  createPerson: (person: PersonRequest) => request<RosterEntry>("/api/admin/roster", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(person)
  }),
  changePerson: (personId: string, person: PersonRequest) => request<RosterEntry>(`/api/admin/roster/${personId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(person)
  }),
  createAccount: (personId: string, account: AccountRequest) => request<RosterEntry>(
    `/api/admin/roster/${personId}/account`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(account)
    }
  ),
  changeAccountRoles: (personId: string, roles: Role[]) => request<RosterEntry>(
    `/api/admin/roster/${personId}/account/roles`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roles })
    }
  ),
  changeAccountUsername: (personId: string, username: string) => request<RosterEntry>(
    `/api/admin/roster/${personId}/account/username`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username })
    }
  ),
  resetAccountPassword: (personId: string, oneTimePassword: string) => request<RosterEntry>(
    `/api/admin/roster/${personId}/account/password`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oneTimePassword })
    }
  ),
  setAccountActive: (personId: string, active: boolean) => request<RosterEntry>(
    `/api/admin/roster/${personId}/account/active`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active })
    }
  ),
  assignMembership: (personId: string, membership: MembershipRequest) => request<RosterEntry>(
    `/api/admin/roster/${personId}/membership`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(membership)
    }
  ),
  endMembership: (personId: string) => request<void>(
    `/api/admin/roster/${personId}/membership`, { method: "DELETE" }
  ),
  membershipTypes: () => request<MembershipType[]>("/api/admin/membership-types"),
  membershipType: (id: string) => request<MembershipType>(`/api/admin/membership-types/${id}`),
  createMembershipType: (type: MembershipTypeRequest) => request<MembershipType>("/api/admin/membership-types", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(type)
  }),
  changeMembershipType: (id: string, type: MembershipTypeRequest) => request<MembershipType>(
    `/api/admin/membership-types/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(type)
    }
  ),
  setMembershipTypeActive: (id: string, active: boolean) => request<MembershipType>(
    `/api/admin/membership-types/${id}/active`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active })
    }
  ),
  importSources: () => request<ImportSource[]>("/api/admin/import/sources"),
  importSource: (sourceId: string) => request<ImportSource>(`/api/admin/import/sources/${sourceId}`),
  createImportSource: (source: ImportSourceRequest) => request<ImportSource>("/api/admin/import/sources", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(source)
  }),
  changeImportSource: (sourceId: string, source: ImportSourceRequest) => request<ImportSource>(
    `/api/admin/import/sources/${sourceId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(source)
    }
  ),
  deleteImportSource: (sourceId: string) => request<void>(
    `/api/admin/import/sources/${sourceId}`, { method: "DELETE" }
  ),
  externalReferences: (sourceId: string, cursor?: string, limit = 50) => request<ExternalReferencePage>(
    `/api/admin/import/sources/${sourceId}/references?${new URLSearchParams({
      limit: String(limit), ...(cursor ? { cursor } : {})
    })}`
  ),
  linkExternalReference: (sourceId: string, reference: ExternalReferenceRequest) => request<ExternalReference>(
    `/api/admin/import/sources/${sourceId}/references`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reference)
    }
  ),
  unlinkExternalReference: (sourceId: string, externalId: string) => request<void>(
    `/api/admin/import/sources/${sourceId}/references/${encodeURIComponent(externalId)}`,
    { method: "DELETE" }
  ),
  // No Content-Type: only the browser knows the boundary it is about to write.
  supportedEncodings: () => request<string[]>("/api/admin/import/encodings"),
  createImportPreview: (sourceId: string, file: File, mode: SnapshotMode, encoding: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("mode", mode);
    form.append("encoding", encoding);
    return request<ImportPreview>(
      `/api/admin/import/sources/${sourceId}/previews`, { method: "POST", body: form }
    );
  },
  importPreview: (previewId: string) => request<ImportPreview>(`/api/admin/import/previews/${previewId}`),
  executeImportPreview: (previewId: string, confirmRemovals: boolean) => request<ImportRun>(
    `/api/admin/import/previews/${previewId}/execution`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmRemovals })
    }
  ),
  importRuns: (sourceId: string) => request<ImportRun[]>(`/api/admin/import/sources/${sourceId}/runs`),
  audit: (cursor?: string, limit = 50, subjectId?: string) => request<AuditPage>(
    `/api/admin/audit?${new URLSearchParams({
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
      ...(subjectId ? { subjectId } : {})
    })}`
  ),
  source: () => request<SourceOffer>("/api/source"),
  courts: () => request<PublicCourt[]>("/api/public/courts"),
  bookingGrid: () => request<BookingGrid>("/api/public/booking-grid"),
  allocations: (date: string) => request<Allocation[]>(
    `/api/bookings?${new URLSearchParams({ date })}`
  ),
  bookingCards: () => request<PublicBookingCard[]>("/api/public/booking-cards"),
  participantCards: () => request<PublicParticipantCard[]>("/api/public/participant-cards"),
  participantMembers: (query: string) => request<PublicParticipantMember[]>(
    `/api/public/participant-members?${new URLSearchParams({ query })}`
  ),
  createBooking: (booking: CreateBookingRequest, idempotencyKey: string) => request<BookingCreated>("/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(booking)
  }),
  cancelBooking: (bookingId: string) => request<void>(`/api/bookings/${bookingId}`, { method: "DELETE" }),
  personalBookings: (cursor?: string, limit = 50) => request<PersonalBookingPage>(
    `/api/my/bookings?${new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) })}`
  ),
  participations: (cursor?: string, limit = 50) => request<ParticipationPage>(
    `/api/my/participations?${new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) })}`
  ),
  withdrawParticipation: (bookingId: string) => request<void>(
    `/api/my/participations/${bookingId}`, { method: "DELETE" }
  ),
  managedAppointments: (cursor?: string, limit = 50) => request<ManagedAppointmentPage>(
    `/api/managed/bookings?${new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) })}`
  ),
  managedAppointment: (bookingId: string) => request<ManagedAppointmentDetail>(
    `/api/managed/bookings/${bookingId}`
  ),
  previewSeries: (rule: SeriesRuleRequest) => request<SeriesPreview>("/api/booking-series/preview", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rule)
  }),
  createSeries: (series: CreateSeriesRequest) => request<SeriesCreated>("/api/booking-series", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(series)
  }),
  cancelSeries: (seriesId: string, fromBookingId: string, scope: CancelScope) => request<void>(
    `/api/booking-series/${seriesId}?${new URLSearchParams({ fromBookingId, scope })}`,
    { method: "DELETE" }
  ),
  previewSeriesMove: (seriesId: string, move: MoveRequest) => request<MovePreview>(
    `/api/booking-series/${seriesId}/move/preview`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(move)
    }
  ),
  moveSeries: (seriesId: string, move: MoveRequest) => request<MoveExecuted>(
    `/api/booking-series/${seriesId}/move`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(move)
    }
  ),
  login: (username: string, password: string) => request<void>("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password })
  }, false),
  changeInitialPassword: (password: string) => request<void>("/api/account/initial-password", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  }),
  logout: () => request<void>("/api/session/logout", { method: "POST" })
};
