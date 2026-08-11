import type { components } from "./schema";

export type SessionStatus = components["schemas"]["SessionStatus"];
export type ClubConfig = components["schemas"]["ClubConfig"];
export type ClubConfigRequest = components["schemas"]["ClubConfigRequest"];
export type RuleSet = components["schemas"]["RuleSet"];
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
export type SourceOffer = components["schemas"]["SourceOffer"];
export type Problem = components["schemas"]["Problem"];
export type PublicCourt = components["schemas"]["PublicCourt"];
export type Allocation = components["schemas"]["Allocation"];
export type BookingGrid = components["schemas"]["BookingGrid"];
export type PublicBookingCard = components["schemas"]["PublicBookingCard"];
export type PublicParticipantCard = components["schemas"]["PublicParticipantCard"];
export type PublicParticipantMember = components["schemas"]["PublicParticipantMember"];
export type CreateBookingRequest = components["schemas"]["CreateBookingRequest"];
export type BookingCreated = components["schemas"]["BookingCreated"];
export type PersonalBooking = components["schemas"]["PersonalBooking"];
export type PersonalBookingPage = components["schemas"]["PersonalBookingPage"];
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
  ruleTypes: () => request<RuleTypeConfiguration[]>("/api/admin/rule-types"),
  rules: (ruleSetId: string) => request<RuleDefinition[]>(`/api/admin/rule-sets/${ruleSetId}/rules`),
  setRule: (ruleSetId: string, ruleType: RuleType, params: Record<string, number>) => request<RuleDefinition>(
    `/api/admin/rule-sets/${ruleSetId}/rules/${ruleType}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ params })
    }
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
