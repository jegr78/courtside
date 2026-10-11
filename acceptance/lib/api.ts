import { request, type APIRequestContext, type APIResponse } from "@playwright/test";
import { config, PASSWORD, persona, type PersonaKey } from "./context";
import { precondition } from "./precondition";
import { admitted } from "./core.mjs";

export const BASE = config.baseUrl;
export type Api = {
  get: (path: string) => Promise<APIResponse>;
  del: (path: string) => Promise<APIResponse>;
  put: (path: string, data: unknown) => Promise<APIResponse>;
  post: (path: string, data: unknown, extra?: Record<string, string>) => Promise<APIResponse>;
  postForm: (path: string, form: Record<string, string>) => Promise<APIResponse>;
  dispose: () => Promise<void>;
};

async function wrap(context: APIRequestContext): Promise<Api> {
  await context.get("/api/session");
  const headers = async () => ({ "X-XSRF-TOKEN": (await context.storageState()).cookies.find((c) => c.name.endsWith("XSRF-TOKEN"))?.value ?? "" });
  return {
    get: (path) => admitted(() => context.get(path)),
    del: (path) => admitted(async () => context.delete(path, { headers: await headers() })),
    put: async (path, data) => context.put(path, { data, headers: await headers() }),
    post: async (path, data, extra = {}) => context.post(path, { data, headers: { ...(await headers()), ...extra } }),
    postForm: (path, form) => admitted(async () => context.post(path, { form, headers: await headers() })),
    dispose: () => context.dispose()
  };
}

const signedIn = new Map<PersonaKey, Promise<Api>>();

async function signIn(key: PersonaKey): Promise<Api> {
  const api = await wrap(await request.newContext({ baseURL: BASE }));
  const login = await api.postForm("/api/session", { username: persona(key).username, password: PASSWORD });
  precondition(login.ok(), `API sign-in for ${key} answered ${login.status()}`);
  precondition((await (await api.get("/api/session")).json()).authenticated === true, `API session for ${key} is authenticated`);
  return { ...api, dispose: async () => undefined };
}

// One API session per persona and worker, independent of the browsers' stored sessions: a reauthentication rotates the session id.
export function apiAs(key: PersonaKey): Promise<Api> {
  if (!signedIn.has(key)) signedIn.set(key, signIn(key).catch((failure) => { signedIn.delete(key); throw failure; }));
  return signedIn.get(key)!;
}

export async function anonymousApi(): Promise<Api> {
  return wrap(await request.newContext({ baseURL: BASE }));
}
