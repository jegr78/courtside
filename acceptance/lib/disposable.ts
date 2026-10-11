import type { APIResponse } from "@playwright/test";
import { anonymousApi, apiAs, type Api } from "./api";
import { disposableRecord } from "./journey";
import { latestMailTo } from "./mail";
import { PASSWORD, persona } from "./context";
import { precondition } from "./precondition";

const own = () => persona("disposable").username;

export async function canSignIn(password: string, username = own()): Promise<boolean> {
  const api = await anonymousApi();
  try {
    const response = await api.postForm("/api/session", { username, password });
    if (!response.ok()) return false;
    return (await (await api.get("/api/session")).json()).authenticated === true;
  } finally { await api.dispose(); }
}

async function resetToShared(username: string) {
  const since = new Date();
  const api = await anonymousApi();
  try {
    const asked = await api.post("/api/account-recovery/password", { username });
    precondition(asked.ok(), `reset code request answered ${asked.status()}`);
    const mail = await latestMailTo(disposableRecord(username).email, since);
    const code = mail && /^Code:\s*(\S+)\s*$/m.exec(mail.text)?.[1];
    precondition(code, "reset code reached Mailpit (the instance limits reset codes per account and hour)");
    const redeemed = await api.post("/api/account-recovery/password/redemption", { code, password: PASSWORD });
    precondition(redeemed.ok(), `reset code redemption answered ${redeemed.status()}`);
  } finally { await api.dispose(); }
}

// Reauthenticates only when the write asks for it, so a healthy account costs no credential check.
async function adminPut(admin: Api, path: string, data: unknown): Promise<APIResponse> {
  const first = await admin.put(path, data);
  if (first.status() !== 401 && first.status() !== 403) return first;
  const reauthenticated = await admin.post("/api/session/reauthentication", { password: PASSWORD });
  precondition(reauthenticated.ok(), `admin reauthentication answered ${reauthenticated.status()}`);
  return admin.put(path, data);
}

export async function restoreDisposable(username = own()) {
  const admin = await apiAs("admin");
  const id = disposableRecord(username).personId;
  const read = await admin.get(`/api/admin/roster/${id}`);
  precondition(read.ok(), `reading the disposable account answered ${read.status()}`);
  const state = await read.json() as { enabled: boolean; locale: string | null };
  const locale = disposableRecord(username).locale ?? "de";
  if (!state.enabled) {
    const active = await adminPut(admin, `/api/admin/roster/${id}/account/active`, { active: true });
    precondition(active.ok(), `reactivating the disposable account answered ${active.status()}`);
  }
  if ((state.locale ?? "de") !== locale) {
    const changed = await adminPut(admin, `/api/admin/roster/${id}/account/locale`, { locale });
    precondition(changed.ok(), `restoring the disposable locale answered ${changed.status()}`);
  }
  if (await canSignIn(PASSWORD, username)) return;
  await resetToShared(username);
  precondition(await canSignIn(PASSWORD, username), "the disposable account signs in with the shared password");
}
