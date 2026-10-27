import { createHmac } from "node:crypto";
import type { CDPSession, Page } from "@playwright/test";
import type { components } from "../../../src/api/schema";
import { expect, test } from "../../fixtures";
import { openTheApplication, walks } from "../../journey-walking";
import { journeyInstant } from "../../global-setup";
import { messageWith } from "../../mailbox";

type MfaStatus = components["schemas"]["MfaStatus"];
type SessionStatus = components["schemas"]["SessionStatus"];
const password = "temporary-password";
const janePerson = "00000000-0000-0000-0000-000000000101";
const janeAccount = "00000000-0000-0000-0000-000000000102";

test.use({ serviceWorkers: "block" });

function totp(secret: string, offset: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let value = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of secret.toUpperCase().replace(/=+$/, "")) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid authenticator setup key");
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 255); value &= (1 << bits) - 1; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.parse(journeyInstant) / 30_000) + offset));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const position = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(position) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function browserJson<T>(page: Page, path: string): Promise<T> {
  return await page.evaluate(async (url) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`The holder request returned ${response.status}`);
    const payload: unknown = await response.json();
    return payload;
  }, path) as T;
}

async function ownMfa(page: Page): Promise<MfaStatus> {
  return browserJson<MfaStatus>(page, "/api/account/mfa");
}

async function session(page: Page): Promise<SessionStatus> {
  return browserJson<SessionStatus>(page, "/api/session");
}

async function enterPassword(page: Page, username: string, chosenPassword = password) {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill(chosenPassword);
  const answered = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/session" && response.request().method() === "POST");
  await page.getByTestId("login-submit").click();
  return await answered;
}

async function signIn(page: Page, username: string, chosenPassword = password) {
  expect((await enterPassword(page, username, chosenPassword)).status()).toBe(200);
  await expect(page.getByTestId("account-identity")).toHaveText(username);
}

async function signOut(page: Page) {
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
}

async function acknowledgeCodes(page: Page) {
  const list = page.getByTestId("mfa-recovery-codes");
  await expect(list.getByRole("listitem")).toHaveCount(10);
  const codes = await list.getByRole("listitem").allTextContents();
  expect(new Set(codes).size).toBe(10);
  await page.getByTestId("mfa-codes-saved").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
  return codes;
}

async function enrollTotp(page: Page) {
  await page.goto("/account");
  await page.getByTestId("mfa-enroll-totp").click();
  const key = page.getByTestId("mfa-manual-key");
  await expect(key).toBeVisible();
  const secret = (await key.textContent())!;
  expect((await ownMfa(page)).enabled, "an unconfirmed setup has not activated MFA").toBe(false);
  await page.getByTestId("mfa-confirm-code").fill(totp(secret, -1));
  await page.getByTestId("mfa-confirm-totp").click();
  const codes = await acknowledgeCodes(page);
  return { secret, codes };
}

async function submitFactor(page: Page, code: string) {
  await page.getByTestId("login-mfa-code").fill(code);
  const answered = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/session/mfa" && response.request().method() === "POST");
  await page.getByTestId("login-mfa-submit").click();
  return await answered;
}

async function signInWithKey(page: Page, username: string) {
  expect((await enterPassword(page, username)).status()).toBe(202);
  await page.getByTestId("login-security-key").click();
  await expect(page.getByTestId("account-identity")).toHaveText(username);
}

async function addVirtualKey(cdp: CDPSession) {
  const created = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "usb", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return created.authenticatorId;
}

async function registerKey(page: Page, label: string) {
  await page.goto("/account");
  await page.getByTestId("mfa-key-label").fill(label);
  const answered = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/account/mfa/webauthn" && response.request().method() === "POST");
  await page.getByTestId("mfa-add-key").click();
  const response = await answered;
  expect(response.ok()).toBe(true);
  return await response.json() as components["schemas"]["MfaRecoveryCodeSet"];
}

test.beforeEach(async ({ page, language }) => {
  await openTheApplication(page, language);
});

test("given voluntary authenticator setup, when confirmation and subsequent sign-ins use TOTP and recovery codes, then password alone stays pending and a used code is refused", walks("mfa-account-security"), async ({ page, language }) => {
  // given
  await signIn(page, "doe.jane");
  expect((await ownMfa(page)).enabled).toBe(false);
  const { secret, codes } = await enrollTotp(page);
  // when
  expect((await enterPassword(page, "doe.jane")).status()).toBe(202);
  await expect(page.getByTestId("login-mfa-code")).toBeVisible();
  expect(await session(page)).toMatchObject({ authenticated: false, mfaRequired: true, roles: [] });
  await page.reload();
  await expect(page.getByTestId("login-mfa-code")).toBeVisible();
  await expect(page.getByTestId("password")).toHaveCount(0);
  const replayed = await submitFactor(page, totp(secret, -1));
  expect(replayed.status()).toBe(403);
  expect(await replayed.json()).toMatchObject({ type: "urn:courtside:error:mfa-proof-failed" });
  expect((await submitFactor(page, totp(secret, 0))).ok()).toBe(true);
  await expect(page.getByTestId("account-identity")).toHaveText("doe.jane");
  await signOut(page);
  expect((await enterPassword(page, "doe.jane")).status()).toBe(202);
  expect((await submitFactor(page, codes[0])).ok()).toBe(true);
  await expect(page.getByTestId("account-identity")).toHaveText("doe.jane");
  await signOut(page);
  expect((await enterPassword(page, "doe.jane")).status()).toBe(202);
  const reused = await submitFactor(page, codes[0]);
  // then
  expect(reused.status()).toBe(403);
  expect(await reused.json()).toMatchObject({ type: "urn:courtside:error:mfa-proof-failed" });
  expect((await submitFactor(page, codes[1])).ok()).toBe(true);
  await expect(page.getByTestId("account-identity")).toHaveText("doe.jane");
  expect(await ownMfa(page)).toMatchObject({ enabled: true, totpEnabled: true, recoveryCodesRemaining: 8 });
  await page.goto("/account");
  await page.screenshot({ path: test.info().outputPath(`mfa-totp-${language}.png`), fullPage: true });
});

test("given virtual CTAP2 keys with user verification, when a holder registers and corrects multiple device labels, then key-only MFA stays private and the remaining key survives removal", walks("mfa-account-security"), async ({ page, context, browserName, language }) => {
  // given
  test.skip(browserName !== "chromium", "CDP virtual authenticators require Chromium");
  test.info().annotations.push({ type: "authenticator", description: "Chromium CDP virtual CTAP2 authenticators with user verification. This test does not exercise physical security-key hardware." });
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const primary = await addVirtualKey(cdp);
  const authenticators = [primary];
  try {
    await signIn(page, "doe.jane");
    expect((await registerKey(page, "Travel key")).codes).toHaveLength(10);
    await acknowledgeCodes(page);
    await signInWithKey(page, "doe.jane");
    const first = (await ownMfa(page)).devices![0];
    expect(await ownMfa(page)).toMatchObject({ totpEnabled: false, devices: [{ label: "Travel key" }] });
    // when
    await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId: primary, enabled: false });
    authenticators.push(await addVirtualKey(cdp));
    expect((await registerKey(page, "Spare key")).codes).toEqual([]);
    await expect(page.getByTestId("login-view")).toBeVisible();
    await expect(page.getByTestId("mfa-recovery-codes")).toHaveCount(0);
    await signInWithKey(page, "doe.jane");
    await page.goto("/account");
    await page.getByTestId(`mfa-device-label-${first.id}`).fill("Home key");
    await page.getByTestId(`mfa-device-rename-${first.id}`).click();
    await expect(page.getByTestId("login-view")).toBeVisible();
    await signInWithKey(page, "doe.jane");
    const devices = (await ownMfa(page)).devices!;
    expect(devices.map((device) => device.label).sort()).toEqual(["Home key", "Spare key"]);
    await signOut(page);
    await signIn(page, "sport.major");
    await page.goto("/account");
    expect((await ownMfa(page)).devices).toEqual([]);
    await expect(page.getByTestId(`mfa-device-label-${first.id}`)).toHaveCount(0);
    await signOut(page);
    await signInWithKey(page, "doe.jane");
    await page.goto("/account");
    await page.getByTestId(`mfa-device-remove-${first.id}`).click();
    await expect(page.getByTestId("login-view")).toBeVisible();
    await signInWithKey(page, "doe.jane");
    // then
    const remaining = await ownMfa(page);
    expect(remaining.enabled).toBe(true);
    expect(remaining.totpEnabled).toBe(false);
    expect(remaining.devices).toHaveLength(1);
    expect(remaining.devices![0].label).toBe("Spare key");
    await page.goto("/account");
    await expect(page.getByTestId(`mfa-device-label-${remaining.devices![0].id}`)).toHaveValue("Spare key");
    await page.screenshot({ path: test.info().outputPath(`mfa-webauthn-${language}.png`), fullPage: true });
  } finally {
    for (const authenticatorId of authenticators) await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await cdp.detach();
  }
});

test("given a holder who lost all factors, when an MFA-authenticated administrator checks identity and starts recovery, then only the mailed code and a new password restore the account", walks("mfa-account-security"), async ({ page, journeyService, language }) => {
  // given
  await signIn(page, "doe.jane");
  await enrollTotp(page);
  await signIn(page, "configuration-admin");
  const administrator = await enrollTotp(page);
  expect((await enterPassword(page, "configuration-admin")).status()).toBe(202);
  expect((await submitFactor(page, totp(administrator.secret, 0))).ok()).toBe(true);
  await expect(page.getByTestId("account-identity")).toHaveText("configuration-admin");
  await page.goto(`/admin/roster/${janePerson}`);
  expect(await browserJson(page, `/api/admin/accounts/${janeAccount}/mfa`)).toEqual({ enabled: true, recoveryPending: false });
  await expect(page.getByTestId("admin-mfa-recover")).toBeDisabled();
  // when
  await page.getByTestId("admin-mfa-identity-checked").check();
  const started = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/admin/accounts/${janeAccount}/mfa-recovery` && response.request().method() === "POST");
  await page.getByTestId("admin-mfa-recover").click();
  expect((await started).status()).toBe(202);
  expect(await browserJson(page, `/api/admin/accounts/${janeAccount}/mfa`)).toMatchObject({ recoveryPending: true });
  const pattern = "[2-9A-HJKMNP-TV-Z]{4}(?:-[2-9A-HJKMNP-TV-Z]{4}){5}";
  const mailed = await messageWith(journeyService.mailboxURL, "jane.doe@example.org", `${pattern}$`);
  const code = new RegExp(`^(${pattern})$`, "m").exec(mailed.Text)?.[1];
  expect(code, "controlled recovery sends its single-use code to the registered mailbox").toBeDefined();
  await signOut(page);
  await page.goto("/account-recovery#controlled-mfa");
  await page.getByTestId("controlled-mfa-username").fill("doe.jane");
  await page.getByTestId("controlled-mfa-code").fill(code!);
  const newPassword = "clay-court-evening-restored";
  await page.getByTestId("controlled-mfa-password").fill(newPassword);
  await page.getByTestId("controlled-mfa-password-confirm").fill(newPassword);
  const redeemed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/account-recovery/mfa/redemption" && response.request().method() === "POST");
  await page.getByTestId("controlled-mfa-submit").click();
  // then
  expect((await redeemed).status()).toBe(204);
  await expect(page.getByTestId("recovery-sent")).toBeVisible();
  await expect(page.getByTestId("controlled-mfa-code")).toHaveValue("");
  await expect(page.getByTestId("controlled-mfa-password")).toHaveValue("");
  await signIn(page, "doe.jane", newPassword);
  expect(await ownMfa(page)).toMatchObject({ enabled: false, totpEnabled: false, recoveryCodesRemaining: 0, devices: [] });
  expect(await session(page)).toMatchObject({ authenticated: true, mfaEnabled: false });
  await page.goto("/account");
  await page.screenshot({ path: test.info().outputPath(`mfa-recovered-${language}.png`), fullPage: true });
});
