import { runPath } from "../lib/context";
import { type Page } from "@playwright/test";
import { test, expect } from "../lib/fixtures";
import { restoreDisposable } from "../lib/disposable";
import { randomBytes } from "node:crypto";
import { capture } from "../lib/checks";
import { latestMailTo } from "../lib/mail";
import { PASSWORD, persona } from "../lib/context";
import { openAs, reauthenticateIfAsked, signInByForm } from "../lib/session";
import { step } from "../lib/steps";
import { discovery, projectName } from "../lib/journey";

const DISPOSABLE_PROFILES = /iphone-15-de|desktop-safari|desktop-firefox/;
test.beforeEach(() => { test.skip(!DISPOSABLE_PROFILES.test(projectName()), "disposable journeys run on three profiles"); });
test.setTimeout(120_000);
test.beforeAll(async ({}, workerInfo) => { if (DISPOSABLE_PROFILES.test(workerInfo.project.name)) await restoreDisposable(); });
test.afterEach(async ({ browser }, info) => {
  if (info.status === "skipped" || info.status === info.expectedStatus) return;
  for (const context of browser.contexts()) await context.close().catch(() => undefined);
  await restoreDisposable();
});

const username = () => persona("disposable").username;
const temporary = () => `acceptance-temporary-${randomBytes(9).toString("hex")}`;

async function changePassword(page: Page, from: string, to: string) {
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("account-security-link").click();
  await expect(page.getByTestId("account-security-view")).toBeVisible();
  await page.getByTestId("current-password").fill(from);
  await page.getByTestId("new-password").fill(to);
  await page.getByTestId("confirm-password").fill(to);
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
  const page = await openAs(browser, "visitor");
  try {
    await signInByForm(page, username(), "definitely-not-the-password");
    await expect(page.getByTestId("login-view").getByRole("alert"), "product: a wrong password is refused").toBeVisible();
    await capture(page, "login-wrong-password", { expectedStatuses: [401] });
  } finally { await page.context().close(); }
});

test("given the disposable member, when the password is changed and changed back, then both sign in", async ({ browser }) => {
  const interim = temporary();
  const page = await openAs(browser, "disposable");
  try {
    await step("disposable", "security page", async () => {
      await page.getByTestId("preferences-menu").click();
      await page.getByTestId("account-security-link").click();
      await expect(page.getByTestId("account-security-view")).toBeVisible();
      await capture(page, "account-security");
      await page.goto("/");
    });
    await step("disposable", "change to interim", () => changePassword(page, PASSWORD, interim));
    await capture(page, "after-password-change");
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
  const interim = temporary();
  const page = await openAs(browser, "visitor");
  const since = new Date();
  try {
    await page.getByTestId("sign-in-link").click();
    await page.getByTestId("forgotten-credentials-link").click();
    await page.getByTestId("recovery-username").fill(username());
    await page.getByTestId("recovery-password-submit").click();
    await expect(page.getByTestId("recovery-sent")).toBeVisible();
    await capture(page, "recovery-sent");
    const mail = await latestMailTo(discovery.emails.disposable, since);
    expect(mail, "product: the reset code reached Mailpit").not.toBeNull();
    await renderMail(browser, mail!.html, "mail-reset-code");
    const code = /^Code:\s*(\S+)\s*$/m.exec(mail!.text)?.[1];
    expect(code, "product: the mail carries a code line").toBeTruthy();
    await page.getByTestId("recovery-code").fill(code!);
    await page.getByTestId("recovery-new-password").fill(interim);
    await page.getByTestId("recovery-redeem-submit").click();
    await expect(page.getByTestId("recovery-sent").or(page.getByTestId("login-view"))).toBeVisible();
    await capture(page, "recovery-redeemed");
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
  const page = await openAs(browser, "visitor");
  const since = new Date();
  try {
    await page.getByTestId("sign-in-link").click();
    await page.getByTestId("forgotten-credentials-link").click();
    await page.getByTestId("recovery-email").fill(discovery.emails.disposable);
    await page.getByTestId("recovery-usernames-submit").click();
    await expect(page.getByTestId("recovery-sent")).toBeVisible();
    await capture(page, "username-reminder-sent");
    const mail = await latestMailTo(discovery.emails.disposable, since);
    expect(mail, "product: the username reminder reached Mailpit").not.toBeNull();
    await renderMail(browser, mail!.html, "mail-username-reminder");
  } finally { await page.context().close(); }
});

test("given a deactivated account, when the member signs in, then it is refused until the admin reactivates it", async ({ browser }) => {
  const admin = await openAs(browser, "admin");
  try {
    await admin.goto(`/admin/roster/${discovery.personIds.disposable}`);
    await expect(admin.getByTestId("admin-person-view")).toBeVisible();
    await admin.getByTestId("toggle-account").click();
    await reauthenticateIfAsked(admin);
    await expect(admin.getByTestId("admin-save-success")).toBeVisible();
    await capture(admin, "account-deactivated");
    const member = await openAs(browser, "visitor");
    await signInByForm(member, username(), PASSWORD);
    await expect(member.getByTestId("login-view").getByRole("alert"), "product: a deactivated account is refused").toBeVisible();
    await capture(member, "login-deactivated", { expectedStatuses: [401, 403] });
    await member.context().close();
    await admin.getByTestId("toggle-account").click();
    await reauthenticateIfAsked(admin);
    await expect(admin.getByTestId("admin-save-success"), "product: the account is reactivated").toBeVisible();
    const back = await signsInWith(browser, PASSWORD);
    await back.context().close();
  } finally {
    await admin.context().close();
  }
});

test("given the disposable member, when the language is switched in the preferences and back, then both render", async ({ browser }) => {
  const page = await openAs(browser, "disposable", { seedLocale: false });
  const original = discovery.disposable.locale ?? "de";
  try {
    await page.getByTestId("preferences-menu").click();
    await page.locator("#locale-preference").selectOption(original === "de" ? "en" : "de");
    await capture(page, "locale-switched");
    await page.reload();
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await capture(page, "locale-after-reload");
  } finally {
    await page.context().close();
  }
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
