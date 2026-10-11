import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { PASSWORD, persona, type PersonaKey } from "../lib/context";
import { signInByForm, statePath } from "../lib/session";

const KEYS: PersonaKey[] = ["admin", "trainer", "youth", "sport", "grounds", "treasurer", "memberA", "memberB", "memberC", "disposable"];
test.describe.configure({ mode: "serial" });

for (const key of KEYS) {
  test(`when ${key} signs in, then the session is stored`, async ({ browser, browserName }) => {
    // when
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await signInByForm(page, persona(key).username, PASSWORD);
    // then
    await expect(page.getByTestId("initial-password-view"), `${key} is not asked for a first password`).toHaveCount(0);
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await expect(page.getByTestId("sign-in-link")).toHaveCount(0);
    mkdirSync(`out/state/${browserName}`, { recursive: true });
    await context.storageState({ path: statePath(browserName, key) });
    await context.close();
  });
}
