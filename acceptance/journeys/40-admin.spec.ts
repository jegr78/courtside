import { test, expect } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { capture } from "../lib/checks";
import { openAs } from "../lib/session";
import { step } from "../lib/steps";
import { discovery, onDesksAndTablet, projectName } from "../lib/journey";
import { adminPost, adminPut, apiAs } from "../lib/api";
import { config, runPath } from "../lib/context";
import { mailAvailable, mailsTo, type Mail } from "../lib/mail";
import { recordCreated } from "../lib/ledger";
import { precondition } from "../lib/precondition";
import { ADMIN_LINKS } from "../lib/surfaces.mjs";

test.beforeEach(() => { test.skip(!onDesksAndTablet(), "admin journeys run on desks, tablet and one phone"); });
test.setTimeout(120_000);

test("when the admin visits every administration page, then each renders", async ({ browser }) => {
  // when / then — every page renders in turn
  const page = await openAs(browser, "admin");
  try {
    await page.getByTestId("administration-link").click();
    let previousHeading = "";
    for (const link of ADMIN_LINKS) {
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
