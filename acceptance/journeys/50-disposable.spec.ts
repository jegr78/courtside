import { runPath } from "../lib/context";
import { type Page } from "@playwright/test";
import { test, expect } from "../lib/fixtures";
import { restoreDisposable } from "../lib/disposable";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { adminPut, apiAs, apiAsAgain } from "../lib/api";
import { runSql } from "../lib/erasure";
import { recordCreated } from "../lib/ledger";
import { precondition } from "../lib/precondition";
import { noShowLimitFor } from "../lib/attendance";
import { answers, seededBookingId, startedBookingSql, violationCodes } from "../lib/core.mjs";
import { capture } from "../lib/checks";
import { latestMailTo } from "../lib/mail";
import { fillSecret } from "../lib/secret-fill";
import { PASSWORD, persona } from "../lib/context";
import { openAs, reauthenticateIfAsked, signInByForm } from "../lib/session";
import { step } from "../lib/steps";
import { discovery, disposableRecord, projectName } from "../lib/journey";
import { DISPOSABLE_PROFILES } from "../config/disposables.mjs";

test.beforeEach(() => { test.skip(!DISPOSABLE_PROFILES.includes(projectName()), "disposable journeys run on three profiles"); });
test.setTimeout(120_000);
test.beforeAll(async ({}, workerInfo) => {
  if (DISPOSABLE_PROFILES.includes(workerInfo.project.name)) await restoreDisposable(persona("disposable", workerInfo.project.name).username);
});
test.afterEach(async ({ browser }, info) => {
  if (info.status === "skipped" || info.status === info.expectedStatus) return;
  for (const context of browser.contexts()) await context.close().catch(() => undefined);
  await restoreDisposable();
});

const username = () => persona("disposable").username;
const temporary = () => `acceptance-temporary-${randomBytes(9).toString("hex")}`;

async function changePassword(page: Page, from: string, to: string) {
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("account-link").click();
  await expect(page.getByTestId("account-security-view")).toBeVisible();
  await fillSecret(page.getByTestId("current-password"), from);
  await fillSecret(page.getByTestId("new-password"), to);
  await fillSecret(page.getByTestId("confirm-password"), to);
  await page.getByTestId("password-submit").click();
  await expect(page.getByTestId("login-view").or(page.getByTestId("sign-in-link")), "product: the password change signs the member out").toBeVisible();
}

async function signsInWith(browser: import("@playwright/test").Browser, password: string) {
  const page = await openAs(browser, "visitor");
  await signInByForm(page, username(), password);
  await expect(page.getByTestId("sign-in-link"), "product: the member is signed in").toHaveCount(0);
  return page;
}

test("given a wrong password, when the disposable member signs in, then the form says no", async ({ browser }) => {
  // given
  const page = await openAs(browser, "visitor");
  try {
    // when
    await signInByForm(page, username(), "definitely-not-the-password");
    // then
    await expect(page.getByTestId("login-view").getByRole("alert"), "product: a wrong password is refused").toBeVisible();
    await capture(page, "login-wrong-password", { expectedStatuses: [401] });
  } finally { await page.context().close(); }
});

test("given the disposable member, when the password is changed and changed back, then both sign in", async ({ browser }) => {
  // given
  const interim = temporary();
  const page = await openAs(browser, "disposable");
  try {
    await step("disposable", "security page", async () => {
      await page.getByTestId("preferences-menu").click();
      await page.getByTestId("account-link").click();
      await expect(page.getByTestId("account-security-view")).toBeVisible();
      await capture(page, "account-security");
      await page.goto("/");
    });
    // when
    await step("disposable", "change to interim", () => changePassword(page, PASSWORD, interim));
    await capture(page, "after-password-change");
    // then — each password signs in after its change
    const second = await signsInWith(browser, interim);
    await step("disposable", "change back", () => changePassword(second, interim, PASSWORD));
    await second.context().close();
    const third = await signsInWith(browser, PASSWORD);
    await third.context().close();
  } finally {
    await page.context().close();
  }
});

test("given a forgotten password, when a reset code is mailed and redeemed, then the member is back in with the shared password", async ({ browser }) => {
  // given
  const interim = temporary();
  const page = await openAs(browser, "visitor");
  const since = new Date();
  try {
    // when
    await page.getByTestId("sign-in-link").click();
    await page.getByTestId("forgotten-credentials-link").click();
    await page.getByTestId("recovery-username").fill(username());
    await page.getByTestId("recovery-password-submit").click();
    await expect(page.getByTestId("recovery-sent")).toBeVisible();
    const requested = await page.getByTestId("recovery-sent").innerText();
    await capture(page, "recovery-sent");
    const mail = await latestMailTo(disposableRecord(username()).email, since);
    // then
    expect(mail, "product: the reset code reached Mailpit").not.toBeNull();
    await renderMail(browser, mail!.html, "mail-reset-code");
    const code = /^Code:\s*(\S+)\s*$/m.exec(mail!.text)?.[1];
    expect(code, "product: the mail carries a code line").toBeTruthy();
    // when
    await page.getByTestId("recovery-code").fill(code!);
    await fillSecret(page.getByTestId("recovery-new-password"), interim);
    const redemption = page.waitForResponse(answers("POST", "/api/account-recovery/password/redemption"));
    await page.getByTestId("recovery-redeem-submit").click();
    expect((await redemption).status(), "product: the reset code is redeemed").toBe(204);
    await expect(page.getByTestId("recovery-sent"), "product: the redemption confirms itself, not the earlier request")
      .not.toHaveText(requested);
    await expect(page.getByTestId("recovery-sent")).toBeVisible();
    await page.getByTestId("recovery-sent").scrollIntoViewIfNeeded();
    await capture(page, "recovery-redeemed");
    // then
    const second = await signsInWith(browser, interim);
    await changePassword(second, interim, PASSWORD);
    await second.context().close();
    const third = await signsInWith(browser, PASSWORD);
    await third.context().close();
  } finally {
    await page.context().close();
  }
});

test("given a forgotten username, when a reminder is asked for by email, then it is mailed", async ({ browser }) => {
  // given
  const page = await openAs(browser, "visitor");
  const since = new Date();
  try {
    // when
    await page.getByTestId("sign-in-link").click();
    await page.getByTestId("forgotten-credentials-link").click();
    await page.getByTestId("recovery-email").fill(disposableRecord(username()).email);
    const reminder = page.waitForResponse(answers("POST", "/api/account-recovery/usernames"));
    await page.getByTestId("recovery-usernames-submit").click();
    // then
    expect((await reminder).status(), "product: the username reminder is accepted").toBe(202);
    await expect(page.getByTestId("recovery-sent")).toBeVisible();
    await page.getByTestId("recovery-sent").scrollIntoViewIfNeeded();
    await capture(page, "username-reminder-sent");
    const mail = await latestMailTo(disposableRecord(username()).email, since);
    expect(mail, "product: the username reminder reached Mailpit").not.toBeNull();
    await renderMail(browser, mail!.html, "mail-username-reminder");
  } finally { await page.context().close(); }
});

test("given a deactivated account, when the member signs in, then it is refused until the admin reactivates it", async ({ browser }) => {
  // given
  const admin = await openAs(browser, "admin");
  try {
    await admin.goto(`/admin/roster/${disposableRecord(username()).personId}`);
    await expect(admin.getByTestId("admin-person-view")).toBeVisible();
    await admin.getByTestId("toggle-account").click();
    await reauthenticateIfAsked(admin);
    await expect(admin.getByTestId("admin-save-success")).toBeVisible();
    await capture(admin, "account-deactivated");
    // when
    const member = await openAs(browser, "visitor");
    await signInByForm(member, username(), PASSWORD);
    // then
    await expect(member.getByTestId("login-view").getByRole("alert"), "product: a deactivated account is refused").toBeVisible();
    await capture(member, "login-deactivated", { expectedStatuses: [401, 403] });
    await member.context().close();
    // when
    await admin.getByTestId("toggle-account").click();
    await reauthenticateIfAsked(admin);
    // then
    await expect(admin.getByTestId("admin-save-success"), "product: the account is reactivated").toBeVisible();
    const back = await signsInWith(browser, PASSWORD);
    await back.context().close();
  } finally {
    await admin.context().close();
  }
});

test("given the disposable member, when the language is switched in the preferences and back, then both render", async ({ browser }) => {
  // given
  const page = await openAs(browser, "disposable", { seedLocale: false });
  const original = disposableRecord(username()).locale ?? "de";
  try {
    // when
    await page.getByTestId("preferences-menu").click();
    await page.locator("#locale-preference").selectOption(original === "de" ? "en" : "de");
    await capture(page, "locale-switched");
    // then
    await page.reload();
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await capture(page, "locale-after-reload");
  } finally {
    await page.context().close();
    await restoreDisposable(username());
  }
});

// A booking three days back is refused for its start whatever else holds, so it probes the rules without writing one.
async function probeRefusals(): Promise<string[]> {
  const api = await apiAsAgain("disposable");
  const courts = await (await api.get("/api/public/courts")).json() as { id: string }[];
  const card = discovery.cards.find((candidate: { active: boolean; allowedRoles: string[] }) => candidate.active && candidate.allowedRoles.length === 0);
  const start = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3 * 86_400_000);
  const answer = await api.post("/api/bookings", {
    courtIds: [courts[0].id], cardId: card.id, startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3_600_000).toISOString(), participants: [{ guestName: "Acceptance Partner" }]
  }, { "Idempotency-Key": randomUUID() });
  const body = await answer.json().catch(() => ({}));
  if (answer.ok() && body.id) recordCreated({ kind: "booking", id: body.id, by: "disposable", project: projectName() });
  expect(answer.status(), `product: the probe in the past is refused by the rules (${JSON.stringify(body)})`).toBe(422);
  return violationCodes(body);
}

test("given a disposable member who did not turn up, when the board records the no-show and later lifts it, then the club refuses the member's bookings only until the lift", async ({ browser }) => {
  test.skip(projectName() !== DISPOSABLE_PROFILES[0], "a lift acts on every no-show of the account, so one profile walks it");
  // given
  const admin = await apiAs("admin");
  const policy = await (await admin.get("/api/admin/attendance-policy")).json() as { enabled: boolean };
  precondition(policy.enabled, "the club records attendance (Fristen und Erinnerungen, Anwesenheit erfassen)");
  const record = disposableRecord(username());
  const limit = await noShowLimitFor(admin, record.personId);
  precondition(limit?.maxNoShows === 1, `the disposable member's rule set refuses bookings from one no-show, it holds ${JSON.stringify(limit)}`);
  const bookingId = seededBookingId(runSql(startedBookingSql(username(), randomInt(0, 171)), `seed-no-show-${projectName()}.sql`));
  precondition(bookingId, "the started booking of the disposable member was seeded");
  // when — the board records that nobody came
  const recorded = await adminPut(admin, `/api/admin/bookings/${bookingId}/attendance`, { outcome: "NO_SHOW" });
  expect(recorded.status(), `product: the no-show is recorded (${await recorded.text()})`).toBe(204);
  // then — the member's next booking is refused for it
  expect(await probeRefusals(), "product: the no-show limit refuses the member").toContain("booking.rule.noShowLimit.reached");
  // when — the board lifts it on the person page
  const page = await openAs(browser, "admin");
  try {
    await page.goto(`/admin/roster/${record.personId}`);
    await expect(page.getByTestId("no-shows-list"), "product: the person page lists the counting no-show").toBeVisible();
    await capture(page, "person-no-shows", { subject: page.getByTestId("no-shows-list") });
    await page.getByTestId("lift-no-shows").click();
    await expect(page.getByTestId("no-shows-lifted"), "product: the board lifts the no-shows").toBeVisible();
    await expect(page.getByTestId("no-shows-none"), "product: nothing counts after the lift").toBeVisible();
    await capture(page, "person-no-shows-lifted");
  } finally { await page.context().close(); }
  // then — the rules still judge the probe, but the no-show no longer refuses it
  const after = await probeRefusals();
  expect(after, "product: the probe is still judged by the rules").toContain("booking.rule.startsInPast");
  expect(after, "product: a lifted no-show refuses nothing").not.toContain("booking.rule.noShowLimit.reached");
});

async function renderMail(browser: import("@playwright/test").Browser, html: string, label: string) {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.setContent(html);
    await page.screenshot({ path: runPath(`shots/mail/${projectName()}-${label}-${width}.png`), fullPage: true });
    await context.close();
  }
}
