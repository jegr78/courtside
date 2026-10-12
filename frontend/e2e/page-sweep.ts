import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import { declaredRoutes, ROUTER_FILES, routePattern, type DeclaredRoute } from "./declared-routes";

export type Persona = "signed out" | "doe.jane" | "configuration-admin" | "bootstrap-admin";

export const PERSONAS: Persona[] = ["signed out", "doe.jane", "configuration-admin", "bootstrap-admin"];

export function routerPages(): DeclaredRoute[] {
  return ROUTER_FILES.flatMap(({ file, base }) =>
    declaredRoutes(readFileSync(resolve(import.meta.dirname, "../src", file), "utf8"), base));
}

// The one page a session only reaches while its password still has to be changed.
export function personas(path: string): Persona[] {
  if (path === "/initial-password") return ["bootstrap-admin"];
  return path.startsWith("/admin") ? ["configuration-admin"] : ["signed out", "doe.jane"];
}

export async function settled(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 10_000 });
}

export async function concretePath(page: Page, path: string): Promise<string | undefined> {
  if (!path.includes("/:")) return path;
  await page.goto(path.slice(0, path.indexOf("/:")));
  await settled(page);
  const pattern = routePattern(path);
  const instance = async () => (await page.locator("a[href]").evaluateAll((links) =>
    links.map((link) => new URL((link as HTMLAnchorElement).href).pathname))).find((href) => pattern.test(href));
  await expect.poll(instance, { timeout: 15_000 }).toBeDefined().catch(() => undefined);
  return instance();
}

export async function become(page: Page, persona: Persona) {
  await page.context().clearCookies();
  if (persona === "signed out") return;
  await page.goto("/login");
  await page.getByTestId("username").fill(persona);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  const signedIn = { "doe.jane": "my-bookings-link", "configuration-admin": "administration-link", "bootstrap-admin": "initial-password-view" };
  await expect(page.getByTestId(signedIn[persona]), `${persona} is signed in`).toBeVisible({ timeout: 10_000 });
}
