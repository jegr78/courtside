import { request, type APIRequestContext, type APIResponse } from "@playwright/test";
import { config, PASSWORD, persona, type PersonaKey } from "./context";
import { precondition } from "./precondition";
import { admitted } from "./core.mjs";
import { applySetCookies, cookieHeader } from "./cookie-jar.mjs";

export const BASE = config.baseUrl;
export type Answer = { ok: () => boolean; status: () => number; headers: () => Record<string, string> };
export type Api = {
  get: (path: string) => Promise<APIResponse>;
  del: (path: string) => Promise<APIResponse>;
  put: (path: string, data: unknown) => Promise<APIResponse>;
  post: (path: string, data: unknown, extra?: Record<string, string>) => Promise<APIResponse>;
  credential: (path: string, payload: { form: Record<string, string> } | { json: unknown }) => Promise<Answer>;
  dispose: () => Promise<void>;
};

// Half the account refill of a default instance, so the harness never spends the budget a persona's page needs.
const REQUEST_INTERVAL_MS = 100;
let nextRequestAt = 0;

async function paced<T>(send: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const wait = Math.max(0, nextRequestAt - now);
  nextRequestAt = Math.max(now, nextRequestAt) + REQUEST_INTERVAL_MS;
  if (wait > 0) await new Promise((done) => setTimeout(done, wait));
  return send();
}

// Playwright traces every request of an APIRequestContext with its body, so a password travels through Node's own fetch.
async function sendCredential(context: APIRequestContext, base: string, path: string, payload: { form: Record<string, string> } | { json: unknown }) {
  const url = new URL(path, base);
  const { cookies } = await context.storageState();
  const form = "form" in payload;
  const response = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: { cookie: cookieHeader(cookies, url), "X-XSRF-TOKEN": cookies.find((c) => c.name.endsWith("XSRF-TOKEN"))?.value ?? "",
      "content-type": form ? "application/x-www-form-urlencoded" : "application/json" },
    body: form ? new URLSearchParams(payload.form) : JSON.stringify(payload.json)
  });
  await response.arrayBuffer();
  const answer: Answer = { ok: () => response.ok, status: () => response.status, headers: () => Object.fromEntries(response.headers) };
  return { answer, cookies: applySetCookies(cookies, response.headers.getSetCookie(), url) };
}

async function wrap(first: APIRequestContext, base = BASE): Promise<Api> {
  let context = first;
  await paced(() => context.get("/api/session"));
  const headers = async () => ({ "X-XSRF-TOKEN": (await context.storageState()).cookies.find((c) => c.name.endsWith("XSRF-TOKEN"))?.value ?? "" });
  return {
    get: (path) => admitted(() => paced(() => context.get(path))),
    del: (path) => admitted(async () => paced(async () => context.delete(path, { headers: await headers() }))),
    put: async (path, data) => paced(async () => context.put(path, { data, headers: await headers() })),
    post: async (path, data, extra = {}) => paced(async () => context.post(path, { data, headers: { ...(await headers()), ...extra } })),
    credential: (path, payload) => admitted(async () => paced(async () => {
      const { answer, cookies } = await sendCredential(context, base, path, payload);
      const next = await request.newContext({ baseURL: base, storageState: { cookies, origins: [] } });
      await context.dispose();
      context = next;
      return answer;
    })),
    dispose: () => context.dispose()
  };
}

const signedIn = new Map<PersonaKey, Promise<Api>>();

async function signIn(key: PersonaKey): Promise<Api> {
  const api = await wrap(await request.newContext({ baseURL: BASE }));
  const login = await api.credential("/api/session", { form: { username: persona(key).username, password: PASSWORD } });
  precondition(login.ok(), `API sign-in for ${key} answered ${login.status()}`);
  precondition((await (await api.get("/api/session")).json()).authenticated === true, `API session for ${key} is authenticated`);
  return { ...api, dispose: async () => undefined };
}

// One API session per persona and worker, independent of the browsers' stored sessions: a reauthentication rotates the session id.
export function apiAs(key: PersonaKey): Promise<Api> {
  if (!signedIn.has(key)) signedIn.set(key, signIn(key).catch((failure) => { signedIn.delete(key); throw failure; }));
  return signedIn.get(key)!;
}

// A membership write ends the member's sessions, so the next request signs in again.
export function apiAsAgain(key: PersonaKey): Promise<Api> {
  signedIn.delete(key);
  return apiAs(key);
}

export async function anonymousApi(base = BASE): Promise<Api> {
  return wrap(await request.newContext({ baseURL: base }), base);
}

// Reauthenticates only when the write asks for it, so a healthy account costs no credential check.
async function adminWrite(admin: Api, write: (path: string, data: unknown) => Promise<APIResponse>, path: string, data: unknown): Promise<APIResponse> {
  const first = await write(path, data);
  if (first.status() !== 401 && first.status() !== 403) return first;
  const reauthenticated = await admin.credential("/api/session/reauthentication", { json: { password: PASSWORD } });
  precondition(reauthenticated.ok(), `admin reauthentication answered ${reauthenticated.status()}`);
  return write(path, data);
}

export const adminPut = (admin: Api, path: string, data: unknown) => adminWrite(admin, admin.put, path, data);
export const adminPost = (admin: Api, path: string, data: unknown) => adminWrite(admin, (p, d) => admin.post(p, d), path, data);
export const adminDelete = (admin: Api, path: string) => adminWrite(admin, (p) => admin.del(p), path, undefined);

export type RosterEntry = { personId: string; username: string | null; roles?: string[]; firstName: string; lastName: string; email: string | null; enabled: boolean; locale?: string | null };

export async function readRoster(api: Api): Promise<RosterEntry[]> {
  const entries: RosterEntry[] = [];
  let cursor: string | undefined;
  do {
    const answer = await api.post("/api/admin/roster-search", cursor ? { cursor } : {});
    precondition(answer.ok(), `reading the roster answered ${answer.status()}`);
    const page = await answer.json() as { entries: RosterEntry[]; nextCursor?: string | null };
    entries.push(...page.entries);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return entries;
}
