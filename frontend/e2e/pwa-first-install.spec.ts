import type { Browser, BrowserContextOptions, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const personPage = "/admin/roster/00000000-0000-0000-0000-000000000103";

async function reportActivationFailure(page: Page, visit: number, phase: "first-page" | "person-page") {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshot = await Promise.race([
      page.evaluate(async () => {
        const pathClass = (value: string, knownPath: string) => {
          try {
            return new URL(value).pathname === knownPath ? "known" : "other";
          } catch {
            return "unavailable";
          }
        };
        const workerState = (worker: ServiceWorker | null) => worker ? {
          state: worker.state,
          script: pathClass(worker.scriptURL, "/sw.js")
        } : null;
        const secureContext = isSecureContext;
        if (!("serviceWorker" in navigator)) return { status: "unavailable", secureContext };
        const controller = workerState(navigator.serviceWorker.controller);
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          return {
            status: "available", secureContext, controller,
            truncated: registrations.length > 4,
            registrations: registrations.slice(0, 4).map((registration) => ({
              scope: pathClass(registration.scope, "/"),
              installing: workerState(registration.installing),
              waiting: workerState(registration.waiting),
              active: workerState(registration.active)
            }))
          };
        } catch {
          return { status: "unavailable", secureContext, controller };
        }
      }),
      new Promise<{ status: "unavailable" }>((resolve) => {
        timer = setTimeout(() => resolve({ status: "unavailable" }), 1_000);
      })
    ]).catch(() => ({ status: "unavailable" }));
    console.log(JSON.stringify({ diagnostic: "pwa-activation", visit, phase, snapshot }));
  } finally {
    clearTimeout(timer);
  }
}

async function administratorSession(browser: Browser, origin: BrowserContextOptions) {
  const context = await browser.newContext({ ...origin, serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByTestId("username").fill("bootstrap-admin");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("court-plan-view")).toBeVisible({ timeout: 10_000 });
    return await context.storageState();
  } finally {
    await context.close();
  }
}

test("given an administrator's first visit, when a person page opens straight after the first page, then no update is offered", async ({ browserName, journeyService, pinnedBrowser }) => {
  // given
  await journeyService.executeSql(
    "UPDATE user_account SET password_change_required = false WHERE username = 'bootstrap-admin'");
  // Firefox keeps its own certificate store, and only the TLS origin is secure enough for a worker.
  const origin = { baseURL: journeyService.baseURL, ignoreHTTPSErrors: browserName === "firefox" };
  const storageState = await administratorSession(pinnedBrowser, origin);
  const prompted: number[] = [];

  // when
  for (let visit = 1; visit <= 6; visit++) {
    const context = await pinnedBrowser.newContext({ ...origin, storageState });
    try {
      const page = await context.newPage();
      await page.goto("/");
      // Playwright's WebKit leaves an install stuck when its page navigates away during it.
      if (browserName === "webkit") {
        const installed = await page.evaluate(() => Promise.race([
          navigator.serviceWorker.ready.then(() => true),
          new Promise<boolean>((expired) => setTimeout(() => expired(false), 10_000))
        ]));
        if (!installed) await reportActivationFailure(page, visit, "first-page");
        expect(installed, `visit ${visit}: the service worker activates on the first page within ten seconds`).toBe(true);
      }
      await page.goto(personPage);
      await expect(page.getByTestId("person-first-name")).toBeVisible({ timeout: 10_000 });
      const activated = await page.evaluate(() => Promise.race([
        navigator.serviceWorker.ready.then(() => new Promise<boolean>((rendered) =>
          requestAnimationFrame(() => requestAnimationFrame(() => rendered(true))))),
        new Promise<boolean>((expired) => setTimeout(() => expired(false), 10_000))
      ]));
      if (!activated) await reportActivationFailure(page, visit, "person-page");
      expect(activated, `visit ${visit}: the service worker activates within ten seconds`).toBe(true);
      if (await page.getByTestId("pwa-update-prompt").count() > 0) prompted.push(visit);
    } finally {
      await context.close();
    }
  }

  // then
  expect(prompted, "a first install is not a new version").toEqual([]);
});
