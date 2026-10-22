import { existsSync, mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PASSWORD, persona, RUN, stateKey, type PersonaKey } from "./context";
import { setPersona, watch } from "./checks";
import { fillSecret } from "./secret-fill";

export const statePath = (engine: string, key: string) => `${RUN}/state/${engine}/${key}.json`;

export async function signInByForm(page: Page, username: string, password: string) {
  const link = page.getByTestId("sign-in-link");
  await expect(link.or(page.getByTestId("login-view"))).toBeVisible();
  if (await link.isVisible()) await link.click();
  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill(username);
  await fillSecret(page.getByTestId("password"), password);
  await page.getByTestId("login-submit").click();
}

export async function reauthenticateIfAsked(page: Page) {
  const submit = page.getByTestId("admin-reauthentication-submit");
  await submit.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  if (await submit.isVisible()) {
    await fillSecret(page.locator("#admin-reauthentication-password"), PASSWORD);
    await submit.click();
    await expect(submit).toBeHidden();
  }
}

type Options = { seedLocale?: boolean };

export async function openAs(browser: Browser, key: PersonaKey | "visitor", options: Options = {}): Promise<Page> {
  const project = test.info().project;
  const profile = project.metadata as { theme: string; locale: string; engine: string };
  const engine = profile.engine;
  const stored = key === "visitor" ? undefined : statePath(engine, stateKey(key));
  const context = await browser.newContext({ ...project.use, storageState: stored && existsSync(stored) ? stored : undefined });
  await context.addInitScript(([theme, locale, seedLocale]) => {
    try {
      if (sessionStorage.getItem("uat-seeded")) return;
      sessionStorage.setItem("uat-seeded", "1");
      localStorage.setItem("courtside.theme", theme);
      if (seedLocale === "yes") localStorage.setItem("courtside.locale", locale);
    } catch { /* opaque origins such as about:blank have no storage */ }
  }, [profile.theme, profile.locale, options.seedLocale === false ? "no" : "yes"]);
  const page = await context.newPage();
  watch(page);
  setPersona(page, key);
  await page.goto("/");
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  if (key !== "visitor" && await page.getByTestId("sign-in-link").isVisible()) {
    await signInByForm(page, persona(key).username, PASSWORD);
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await expect(page.getByTestId("sign-in-link")).toHaveCount(0);
    mkdirSync(`${RUN}/state/${engine}`, { recursive: true });
    await context.storageState({ path: stored! });
  }
  // A journey that navigates on before the week has loaded aborts its requests, which WebKit reports as page errors.
  await expect(page.getByTestId("day-plan-table")).toBeVisible();
  await expect(page.locator('p[role="status"]:not([data-testid])')).toHaveCount(0);
  return page;
}

export async function xsrf(page: Page) {
  return (await page.context().cookies()).find((cookie) => cookie.name.endsWith("XSRF-TOKEN"))?.value ?? "";
}
