import { test, expect } from "@playwright/test";
import { loadavg } from "node:os";
import { writeFileSync } from "node:fs";
import { apiAs } from "../lib/api";
import { canSignIn } from "../lib/disposable";
import { allSlots, instantOf } from "../lib/lanes";
import { config, disposables, PASSWORD, runPath, type PersonaKey } from "../lib/context";
import { mailAvailable } from "../lib/mail";
import { profilesOf, resetQuota } from "../config/disposables.mjs";
import { occupying } from "../lib/core.mjs";


test("when the environment is checked before a run, then every precondition holds", async () => {
  const admin = await apiAs("admin");
  const checks: Record<string, unknown> = {};
  try {
    const source = await (await admin.get("/api/source")).json();
    checks.version = source.version;
    checks.mail = config.mail ? await fetch(`${config.mail.url}/api/v1/info`).then((r) => r.ok, () => false) : "not configured";
    checks.metrics = config.metrics ? await fetch(`${config.metrics.url}?query=up`).then((r) => r.json()).then((j) => j.status, () => "unreachable") : "not configured";
    checks.windowStart = allSlots()[0]?.date ?? null;
    checks.load = loadavg()[0];
    const courts = await (await admin.get("/api/public/courts")).json() as { id: string; number: number }[];
    const days = new Map<string, unknown>();
    for (const slot of allSlots()) if (!days.has(slot.date)) days.set(slot.date, await (await admin.get(`/api/bookings?date=${slot.date}`)).json());
    checks.occupiedSlots = allSlots().flatMap((s) => occupying(days.get(s.date) as never, courts.find((c) => c.number === s.court)!.id,
      instantOf(s, "start"), instantOf(s, "end")).map((id) => `${s.profile}/${s.journey}: ${id}`));
    const open: Record<string, number> = {};
    for (const key of ["memberA", "memberB", "memberC", "trainer", "youth", "sport", "grounds"] as PersonaKey[]) {
      const api = await apiAs(key);
      let count = 0; let cursor: string | undefined;
      do {
        const page = await (await api.get(`/api/my/bookings?limit=50${cursor ? `&cursor=${cursor}` : ""}`)).json();
        count += page.items.filter((b: { status: string; endsAt: string }) => b.status === "CONFIRMED" && Date.parse(b.endsAt) > Date.now()).length;
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      open[key] = count;
      await api.dispose();
    }
    checks.openBookings = open;
    checks.disposablesSignIn = Object.fromEntries(await Promise.all(disposables.map(async (username, index) => [`disposable ${index + 1}`, await canSignIn(PASSWORD, username)])));
    const weeks = await (await admin.get("/api/admin/opening-hours/schedule")).json() as { effectiveFrom: string | null }[];
    checks.futureWeeks = weeks.slice(1).map((w) => w.effectiveFrom);
    const roster = await (await admin.post("/api/admin/roster-search", {})).json() as { entries: { username: string | null; email: string | null }[] };
    const resetQuotas: Record<string, unknown> = {};
    for (const [index, username] of disposables.entries()) {
      const email = roster.entries.find((e) => e.username === username)?.email;
      const mails = mailAvailable()
        ? await fetch(`${config.mail!.url}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`).then((r) => r.json(), () => ({ messages: [] }))
        : { messages: [] };
      const sentAt = (mails.messages ?? []).filter((m: { Subject: string }) => /Code|code/.test(m.Subject)).map((m: { Created: string }) => Date.parse(m.Created));
      resetQuotas[`disposable ${index + 1}`] = resetQuota({ sentAt, now: Date.now(), perHour: config.resetCodesPerHour, needed: profilesOf(username, disposables).length + 1 });
    }
    checks.resetQuotas = resetQuotas;
  } finally {
    writeFileSync(runPath("preflight.json"), JSON.stringify(checks, null, 2));
    await admin.dispose();
  }
  expect.soft(checks.version, `PRECONDITION: the instance runs ${config.expectedVersion}`).toBe(config.expectedVersion);
  if (config.mail) expect.soft(checks.mail, "PRECONDITION: the mail API answers").toBe(true);
  if (config.metrics) expect.soft(checks.metrics, "PRECONDITION: the metrics endpoint answers").toBe("success");
  expect.soft(checks.occupiedSlots, "PRECONDITION: every reserved slot is free").toEqual([]);
  for (const [key, count] of Object.entries(checks.openBookings as Record<string, number>)) expect.soft(count, `PRECONDITION: ${key} has at most 6 open bookings`).toBeLessThanOrEqual(6);
  for (const [account, signsIn] of Object.entries(checks.disposablesSignIn as Record<string, boolean>)) {
    expect.soft(signsIn, `PRECONDITION: ${account} signs in with the shared password`).toBe(true);
  }
  expect.soft(checks.futureWeeks, "PRECONDITION: no opening week is scheduled after today").toEqual([]);
  for (const [account, quota] of Object.entries(checks.resetQuotas as Record<string, { ok: boolean; sentInLastHour: number; freeAt: string | null }>)) {
    expect.soft(quota.ok, `PRECONDITION: ${account} can still receive the reset codes this run needs (${quota.sentInLastHour} sent in the last hour, enough again at ${quota.freeAt})`).toBe(true);
  }
});
