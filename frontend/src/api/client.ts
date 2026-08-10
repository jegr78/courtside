import type { components } from "./schema";

export type SessionStatus = components["schemas"]["SessionStatus"];
export type ClubConfig = components["schemas"]["ClubConfig"];
export type SourceOffer = components["schemas"]["SourceOffer"];
export type Problem = components["schemas"]["Problem"];
export type PublicCourt = components["schemas"]["PublicCourt"];
export type Allocation = components["schemas"]["Allocation"];
export type BookingGrid = components["schemas"]["BookingGrid"];

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
  source: () => request<SourceOffer>("/api/source"),
  courts: () => request<PublicCourt[]>("/api/public/courts"),
  bookingGrid: () => request<BookingGrid>("/api/public/booking-grid"),
  allocations: (date: string) => request<Allocation[]>(
    `/api/bookings?${new URLSearchParams({ date })}`
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
