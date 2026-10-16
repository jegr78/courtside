import { test, expect } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { capture } from "../lib/checks";
import { openAs, reauthenticateIfAsked } from "../lib/session";
import { step } from "../lib/steps";
import { discovery, disposableRecord, onDesksAndTablet, projectName } from "../lib/journey";
import { adminPost, adminPut, anonymousApi, apiAs } from "../lib/api";
import { config, persona, runPath } from "../lib/context";
import type { Page } from "@playwright/test";
import { latestMailTo, mailAvailable, mailsTo, type Mail } from "../lib/mail";
import { recordCreated } from "../lib/ledger";
import { precondition } from "../lib/precondition";
import { adminLinks } from "../lib/surfaces.mjs";

test.beforeEach(() => { test.skip(!onDesksAndTablet(), "admin journeys run on desks, tablet and one phone"); });
test.setTimeout(120_000);

test("when the admin visits every administration page, then each renders", async ({ browser }) => {
  // when / then — every page renders in turn
  const page = await openAs(browser, "admin");
  try {
    await page.getByTestId("administration-link").click();
    let previousHeading = "";
    await expect(page.getByTestId("admin-navigation")).toBeVisible();
    const links = adminLinks(await page.getByTestId("admin-navigation").locator("a[data-testid]")
      .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("data-testid"))));
    expect(links, "product: the navigation offers the usage report").toContain("admin-usage-link");
    for (const link of links) {
      await step("admin", link, async () => {
        await expect(page.getByTestId("admin-navigation")).toBeVisible();
        const destination = page.getByTestId(link);
        if (!await destination.isVisible()) await page.getByTestId("admin-menu").click();
        await expect(destination).toBeVisible();
        const href = await destination.getAttribute("href");
        await destination.click();
        const target = new RegExp(`${(href ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
        const reached = await expect(page).toHaveURL(target, { timeout: 3_000 }).then(() => true, () => false);
        if (!reached && href) {
          appendFileSync(runPath("observations.jsonl"), JSON.stringify({ project: test.info().project.name, test: link, note: "menu link did not navigate, page opened by URL (see M2)" }) + "\n");
          await page.goto(href);
        }
        const settled = await expect.poll(async () => {
          const heading = (await page.locator("main h1, main h2").first().textContent().catch(() => "")) ?? "";
          const loading = await page.locator('p[role="status"]').count();
          return loading === 0 && heading !== "" && heading !== previousHeading;
        }, { timeout: 15_000 }).toBe(true).then(() => true, () => false);
        if (!settled) appendFileSync(runPath("observations.jsonl"), JSON.stringify({ project: test.info().project.name, test: link, note: "page heading unchanged or loading status still shown 15 s after navigation" }) + "\n");
        previousHeading = (await page.locator("main h1, main h2").first().textContent().catch(() => "")) ?? "";
        await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
        await capture(page, link.replace(/^admin-|-link$/g, ""));
      });
    }
  } finally { await page.context().close(); }
});

test("when the admin opens a member and a booking card, then the detail pages render without saving", async ({ browser }) => {
  // when / then — each detail page renders
  const page = await openAs(browser, "admin");
  try {
    await step("admin", "person detail", async () => {
      await page.goto(`/admin/roster/${discovery.personIds["memberA"]}`);
      await expect(page.getByTestId("admin-person-view")).toBeVisible();
      await capture(page, "person-detail");
    });
    await step("admin", "booking card detail", async () => {
      await page.goto(`/admin/facility/booking-cards/${discovery.cardFor.training}`);
      await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
      await capture(page, "booking-card-detail");
    });
  } finally { await page.context().close(); }
});

test("given welcome accounts are allowed, when the admin creates an account, then its welcome names the instance and comes before the first password", async () => {
  // given
  test.skip(projectName() !== "desktop-chrome", "one account per run is enough to read the welcome");
  precondition(config.welcomeAccounts, "welcomeAccounts is off, so the welcome mail is not checkable");
  precondition(mailAvailable(), "mail.url is not configured, so no account is created to read its welcome");
  const admin = await apiAs("admin");
  const tag = Date.now().toString(36);
  const email = `acceptance-welcome-${tag}@${discovery.emails["memberA"].split("@")[1]}`;
  const since = new Date();
  const person = await adminPost(admin, "/api/admin/roster", { firstName: "Acceptance", lastName: `Welcome ${tag}`, email });
  expect(person.status(), "product: the admin adds the person").toBeLessThan(300);
  const { personId } = await person.json() as { personId: string };
  recordCreated({ kind: "account", id: personId, by: "admin", project: projectName() });
  let created = false;
  try {
    // when
    const account = await adminPost(admin, `/api/admin/roster/${personId}/account`, { username: `acceptance-welcome-${tag}`, roles: ["MEMBER"] });
    expect(account.status(), "product: the admin creates the account").toBeLessThan(300);
    created = true;
    // then — the messages are told apart by content, and no assertion prints their text
    const mails = await mailsTo(email, since, 2);
    const carriesCredential = (mail: Mail) => /One-time password|Einmalpasswort/.test(mail.text);
    const welcome = mails.find((mail) => !carriesCredential(mail));
    const credentials = mails.find(carriesCredential);
    expect(welcome !== undefined, "product: a welcome without a password reaches the new member").toBe(true);
    expect(credentials !== undefined, "product: the sign-in details reach the new member").toBe(true);
    expect(welcome!.text.includes(new URL(config.baseUrl).host), "product: the welcome names the instance").toBe(true);
    expect(Date.parse(welcome!.created!) <= Date.parse(credentials!.created!), "product: the welcome comes before the sign-in details").toBe(true);
  } finally {
    if (created) {
      const deactivated = await adminPut(admin, `/api/admin/roster/${personId}/account/active`, { active: false });
      expect.soft(deactivated.status(), "the account this run created is deactivated again").toBeLessThan(300);
    }
  }
});

async function downloadLog(page: Page, log: "audit" | "messages", from: string, to: string): Promise<string[]> {
  const id = `${log}-log-export`;
  await page.getByTestId(`${id}-from`).fill(from);
  await page.getByTestId(`${id}-to`).fill(to);
  await page.getByTestId(`${id}-separator`).selectOption(";");
  await page.getByTestId(`${id}-encoding`).selectOption("UTF-8");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(`${id}-download`).click()]);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(Buffer.concat(chunks)).split("\r\n").filter((line) => line !== "");
}

test("given a name that reads like a formula, when the admin downloads both logs, then each file has its header and separator and the name stays text", async ({ browser }) => {
  // given — the disposable person's first name starts with "=" for the length of this test
  test.skip(projectName() !== "desktop-chrome", "one pair of log exports per run is enough");
  const admin = await apiAs("admin");
  const personId = disposableRecord(persona("disposable").username).personId;
  const read = await admin.get(`/api/admin/roster/${personId}`);
  precondition(read.ok(), `reading the disposable person answered ${read.status()}`);
  const original = await read.json() as { firstName: string; lastName: string; email: string | null };
  const formula = `=${original.firstName}`.slice(0, 60);
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const page = await openAs(browser, "admin");
  let renamed = false;
  try {
    const rename = await adminPut(admin, `/api/admin/roster/${personId}`,
      { firstName: formula, lastName: original.lastName, email: original.email });
    expect(rename.status(), "product: the admin corrects the disposable person's name").toBeLessThan(300);
    renamed = true;
    await page.goto("/admin/export");
    await expect(page.getByTestId("audit-log-export-encoding")).toContainText("UTF-8");

    // when
    const audit = await step("admin", "audit log export", () => downloadLog(page, "audit", day(-1), day(1)));
    const messages = await step("admin", "message log export", () => downloadLog(page, "messages", day(-1), day(1)));

    // then — names are compared, never printed
    expect(audit[0], "product: the audit log file opens with a byte order mark and its header in the chosen separator")
      .toBe("﻿occurredAt;eventType;subjectId;subjectName;actorAccountId;actorUsername;parameters");
    expect(messages[0], "product: the message log file opens with a byte order mark and its header in the chosen separator")
      .toBe("﻿queuedAt;settledAt;kind;state;messageId;personId;personName;reason;statusCode");
    const subjectNames = audit.slice(1).map((line) => line.split(";")[3]);
    const fullName = `${formula} ${original.lastName}`;
    expect(subjectNames.includes(`'${fullName}`), "product: the correction appears with its formula-looking name neutralised").toBe(true);
    expect(subjectNames.includes(fullName), "product: no cell starts with the formula itself").toBe(false);
    const recorded = await admin.get("/api/admin/audit?limit=20");
    const entries = (await recorded.json() as { entries: { eventType: string; subjectId?: string | null }[] }).entries;
    expect(entries.filter((entry) => entry.eventType === "dataexchange.log.exported" && !entry.subjectId).length,
      "product: both exports are recorded for the whole instance").toBeGreaterThanOrEqual(2);
  } finally {
    await page.context().close();
    if (renamed) {
      const restored = await adminPut(admin, `/api/admin/roster/${personId}`,
        { firstName: original.firstName, lastName: original.lastName, email: original.email });
      expect.soft(restored.status(), "the disposable person carries their own name again").toBeLessThan(300);
    }
  }
});

test("given the club's own wording of the username reminder, when a reminder is asked for, then it arrives in that wording until the admin restores the shipped one", async ({ browser }) => {
  // given
  test.skip(projectName() !== "desktop-chrome", "the wording is global, so one profile changes it");
  precondition(mailAvailable(), "mail.url is not configured, so the reworded reminder is not checkable");
  const marker = `UAT-wording-${Date.now().toString(36)}`;
  const page = await openAs(browser, "admin");
  try {
    await step("admin", "message wording", async () => {
      await page.goto("/admin/message-wording");
      await page.getByTestId("wording-kind").selectOption("ACCOUNT_USERNAME_REMINDER");
      for (const language of ["de", "en"]) {
        await page.getByTestId("wording-language").selectOption(language);
        await page.getByTestId("wording-subject").fill(`${marker} {clubName}`);
        await page.getByTestId("wording-body").fill(`${marker}\n{firstName}: {username}\n{instanceLink}`);
        await page.getByTestId("wording-preview").click();
        await expect(page.getByTestId("wording-preview-body"), "product: the preview fills the wording").toContainText(marker);
        await expect(page.getByTestId("wording-preview-body"), "product: the preview leaves no placeholder").not.toContainText("{username}");
        recordCreated({ kind: "template", id: `ACCOUNT_USERNAME_REMINDER/${language}`, by: "admin", project: projectName() });
        await page.getByTestId("wording-save").click();
        await reauthenticateIfAsked(page);
        await expect(page.getByTestId("wording-state"), `product: the ${language} wording is stored`).toHaveAttribute("data-own", "true");
      }
      await capture(page, "message-wording");
    });
    const email = discovery.emails["memberA"];
    const since = new Date();

    // when
    const visitor = await anonymousApi();
    const asked = await visitor.post("/api/account-recovery/usernames", { email });
    await visitor.dispose();
    expect(asked.status(), "product: the username reminder is accepted").toBeLessThan(300);

    // then
    const mail = await latestMailTo(email, since, new RegExp(marker));
    expect(mail, "product: the reminder arrives in the club's wording").not.toBeNull();
    expect(mail!.text.includes(new URL(config.baseUrl).host), "product: the reworded reminder links the instance").toBe(true);
  } finally {
    await step("admin", "restore message wording", async () => {
      await page.goto("/admin/message-wording");
      await page.getByTestId("wording-kind").selectOption("ACCOUNT_USERNAME_REMINDER");
      for (const language of ["de", "en"]) {
        await page.getByTestId("wording-language").selectOption(language);
        if (await page.getByTestId("wording-reset").isEnabled()) {
          await page.getByTestId("wording-reset").click();
          await reauthenticateIfAsked(page);
        }
        await expect(page.getByTestId("wording-state"), `product: the shipped ${language} wording applies again`).toHaveAttribute("data-own", "false");
      }
    });
    await page.context().close();
  }
});
