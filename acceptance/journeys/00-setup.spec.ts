import { test, expect } from "@playwright/test";
import { disposables, PASSWORD, persona, stateKey, type PersonaKey } from "../lib/context";
import { signInByForm, statePath } from "../lib/session";

const KEYS: PersonaKey[] = ["admin", "trainer", "youth", "sport", "grounds", "treasurer", "memberA", "memberB", "memberC"];
const ACCOUNTS = [
  ...KEYS.map((key) => ({ label: key, username: persona(key, "").username, state: stateKey(key, persona(key, "").username) })),
  ...disposables.map((username, index) => ({ label: `disposable ${index + 1}`, username, state: stateKey("disposable", username) }))
];
test.describe.configure({ mode: "serial" });

for (const account of ACCOUNTS) {
  test(`when ${account.label} signs in, then the session is stored`, async ({ browser, browserName }) => {
    // when
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await signInByForm(page, account.username, PASSWORD);
    // then
    await expect(page.getByTestId("initial-password-view"), `${account.label} is not asked for a first password`).toHaveCount(0);
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await expect(page.getByTestId("sign-in-link")).toHaveCount(0);
    await context.storageState({ path: statePath(browserName, account.state) });
    await context.close();
  });
}
