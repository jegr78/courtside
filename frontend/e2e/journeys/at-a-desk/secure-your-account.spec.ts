import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  activate, openTheAccountMenu, openTheApplication, reachAdministration, rewrite,
  signIn as enterPassword, signOut, walks, writeInto
} from "../../journey-walking";
import { journeyInstant } from "../../global-setup";
import { messageWith } from "../../mailbox";
import { authenticatorCode, virtualSecurityKeys } from "../../mfa-authenticator";

const messages = {
  de: {
    disabled: "Zwei-Faktor-Authentifizierung ist nicht aktiviert.",
    enabled: "Zwei-Faktor-Authentifizierung ist aktiviert.",
    proofFailed: "Der zweite Faktor wurde nicht akzeptiert.",
    recoveryPending: "Kontowiederherstellung läuft.",
    signInRefused: "Benutzername oder Passwort ist nicht richtig."
  },
  en: {
    disabled: "Two-factor authentication is not enabled.",
    enabled: "Two-factor authentication is enabled.",
    proofFailed: "The second factor was not accepted.",
    recoveryPending: "Account recovery is pending.",
    signInRefused: "The username or password is incorrect."
  }
};
const janePerson = "00000000-0000-0000-0000-000000000101";

test.use({ serviceWorkers: "block" });

async function signIn(page: Page, username: string, password = "temporary-password") {
  await enterPassword(page, username, password);
  await expect(page.getByTestId("account-identity")).toHaveText(username);
}

async function reachYourAccount(page: Page) {
  await openTheAccountMenu(page);
  await activate(page.getByTestId("account-link"));
  await expect(page.getByTestId("account-security-view")).toBeVisible();
}

async function acknowledgeCodes(page: Page) {
  const list = page.getByTestId("mfa-recovery-codes");
  await expect(list.getByRole("listitem")).toHaveCount(10);
  const codes = await list.getByRole("listitem").allTextContents();
  expect(new Set(codes).size).toBe(10);
  await activate(page.getByTestId("mfa-codes-saved"));
  await expect(page.getByTestId("login-view")).toBeVisible();
  return codes;
}

async function beginAuthenticatorSetup(page: Page) {
  await reachYourAccount(page);
  await activate(page.getByTestId("mfa-enroll-totp"));
  const key = page.getByTestId("mfa-manual-key");
  await expect(key).toBeVisible();
  return (await key.textContent())!;
}

async function confirmAuthenticatorSetup(page: Page, secret: string) {
  await writeInto(page.getByTestId("mfa-confirm-code"), authenticatorCode(secret, journeyInstant, -1));
  await activate(page.getByTestId("mfa-confirm-totp"));
  return await acknowledgeCodes(page);
}

async function submitFactor(page: Page, code: string) {
  await rewrite(page.getByTestId("login-mfa-code"), code);
  await activate(page.getByTestId("login-mfa-submit"));
}

async function signInWithKey(page: Page, username: string) {
  await enterPassword(page, username);
  await expect(page.getByTestId("login-mfa-code")).toBeVisible();
  await activate(page.getByTestId("login-security-key"));
  await expect(page.getByTestId("account-identity")).toHaveText(username);
}

async function registerKey(page: Page, label: string) {
  await reachYourAccount(page);
  await writeInto(page.getByTestId("mfa-key-label"), label);
  await activate(page.getByTestId("mfa-add-key"));
}

test.beforeEach(async ({ page, language }) => {
  await openTheApplication(page, language);
});

test("given voluntary authenticator setup, when confirmation and subsequent sign-ins use TOTP and recovery codes, then password alone stays pending and a used code is refused", walks("mfa-account-security"), async ({ page, language }) => {
  // given
  await signIn(page, "doe.jane");
  const secret = await beginAuthenticatorSetup(page);
  await expect(page.getByTestId("mfa-status")).toHaveText(messages[language].disabled);
  const codes = await confirmAuthenticatorSetup(page, secret);

  // when
  await enterPassword(page, "doe.jane");
  await expect(page.getByTestId("login-mfa-code")).toBeVisible();
  await expect(page.getByTestId("account-identity")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("login-mfa-code")).toBeVisible();
  await expect(page.getByTestId("password")).toHaveCount(0);
  await submitFactor(page, authenticatorCode(secret, journeyInstant, -1));
  await expect(page.getByRole("alert")).toContainText(messages[language].proofFailed);
  await expect(page.getByTestId("account-identity")).toHaveCount(0);
  await submitFactor(page, authenticatorCode(secret, journeyInstant));
  await expect(page.getByTestId("account-identity")).toHaveText("doe.jane");
  await signOut(page);
  await enterPassword(page, "doe.jane");
  await submitFactor(page, codes[0]);
  await expect(page.getByTestId("account-identity")).toHaveText("doe.jane");
  await signOut(page);
  await enterPassword(page, "doe.jane");
  await submitFactor(page, codes[0]);

  // then
  await expect(page.getByRole("alert")).toContainText(messages[language].proofFailed);
  await expect(page.getByTestId("account-identity")).toHaveCount(0);
  await submitFactor(page, codes[1]);
  await expect(page.getByTestId("account-identity")).toHaveText("doe.jane");
  await reachYourAccount(page);
  await expect(page.getByTestId("mfa-status")).toHaveText(messages[language].enabled);
  await expect(page.getByTestId("mfa-remove-totp")).toBeVisible();
  await expect(page.getByTestId("mfa-recovery-remaining")).toContainText(/\b8\b/);
  await page.screenshot({ path: test.info().outputPath(`mfa-totp-${language}.png`), fullPage: true });
});

test("given virtual CTAP2 keys with user verification, when a holder registers and corrects multiple device labels, then key-only MFA stays private and the remaining key survives removal", walks("mfa-account-security"), async ({ page, context, browserName, language }) => {
  // given
  test.skip(browserName !== "chromium", "CDP virtual authenticators require Chromium");
  test.info().annotations.push({ type: "authenticator", description: "Chromium CDP virtual CTAP2 authenticators with user verification. This test does not exercise physical security-key hardware." });
  const keys = await virtualSecurityKeys(context, page);
  await keys.add();
  try {
    await signIn(page, "doe.jane");
    await registerKey(page, "Travel key");
    await acknowledgeCodes(page);
    await signInWithKey(page, "doe.jane");
    await reachYourAccount(page);
    const first = page.locator('[data-testid^="mfa-device-label-"]').first();
    await expect(first).toHaveValue("Travel key");
    const firstId = (await first.getAttribute("data-testid"))!.replace("mfa-device-label-", "");
    await expect(page.getByTestId("mfa-remove-totp")).toHaveCount(0);

    // when
    await keys.useOnly(await keys.add());
    await registerKey(page, "Spare key");
    await expect(page.getByTestId("login-view")).toBeVisible();
    await expect(page.getByTestId("mfa-recovery-codes")).toHaveCount(0);
    await signInWithKey(page, "doe.jane");
    await reachYourAccount(page);
    await rewrite(page.getByTestId(`mfa-device-label-${firstId}`), "Home key");
    await activate(page.getByTestId(`mfa-device-rename-${firstId}`));
    await expect(page.getByTestId("login-view")).toBeVisible();
    await signInWithKey(page, "doe.jane");
    await reachYourAccount(page);
    await expect(page.locator('[data-testid^="mfa-device-label-"]')).toHaveCount(2);
    await expect(page.getByTestId(`mfa-device-label-${firstId}`)).toHaveValue("Home key");
    await signOut(page);
    await signIn(page, "sport.major");
    await reachYourAccount(page);
    await expect(page.getByTestId("mfa-status")).toHaveText(messages[language].disabled);
    await expect(page.locator('[data-testid^="mfa-device-label-"]')).toHaveCount(0);
    await signOut(page);
    await signInWithKey(page, "doe.jane");
    await reachYourAccount(page);
    await activate(page.getByTestId(`mfa-device-remove-${firstId}`));
    await expect(page.getByTestId("login-view")).toBeVisible();
    await signInWithKey(page, "doe.jane");

    // then
    await reachYourAccount(page);
    await expect(page.getByTestId("mfa-status")).toHaveText(messages[language].enabled);
    await expect(page.getByTestId("mfa-remove-totp")).toHaveCount(0);
    const remaining = page.locator('[data-testid^="mfa-device-label-"]');
    await expect(remaining).toHaveCount(1);
    await expect(remaining).toHaveValue("Spare key");
    await page.screenshot({ path: test.info().outputPath(`mfa-webauthn-${language}.png`), fullPage: true });
  } finally {
    await keys.close();
  }
});

test("given a holder who lost all factors, when an MFA-authenticated administrator checks identity and starts recovery, then only the mailed code and a new password restore the account", walks("mfa-account-security"), async ({ page, journeyService, language }) => {
  // given
  await signIn(page, "doe.jane");
  const holderSecret = await beginAuthenticatorSetup(page);
  await confirmAuthenticatorSetup(page, holderSecret);
  await signIn(page, "configuration-admin");
  const administratorSecret = await beginAuthenticatorSetup(page);
  await confirmAuthenticatorSetup(page, administratorSecret);
  await enterPassword(page, "configuration-admin");
  await submitFactor(page, authenticatorCode(administratorSecret, journeyInstant));
  await expect(page.getByTestId("account-identity")).toHaveText("configuration-admin");
  await activate(page.getByTestId("administration-link"));
  await reachAdministration(page, "admin-roster-link");
  await writeInto(page.getByTestId("roster-search"), "Jane Doe");
  await activate(page.getByTestId("roster-search-submit"));
  await activate(page.getByTestId(`person-link-${janePerson}`));
  await expect(page.getByTestId("admin-mfa-status")).toHaveText(messages[language].enabled);
  await expect(page.getByTestId("admin-mfa-recover")).toBeDisabled();

  // when
  await activate(page.getByTestId("admin-mfa-identity-checked"));
  await activate(page.getByTestId("admin-mfa-recover"));
  await expect(page.getByTestId("admin-mfa-status")).toContainText(messages[language].recoveryPending);
  const pattern = "[2-9A-HJKMNP-TV-Z]{4}(?:-[2-9A-HJKMNP-TV-Z]{4}){5}";
  const mailed = await messageWith(journeyService.mailboxURL, "jane.doe@example.org", `${pattern}$`);
  const code = new RegExp(`^(${pattern})$`, "m").exec(mailed.Text)?.[1];
  expect(code, "controlled recovery sends its single-use code to the registered mailbox").toBeDefined();
  await signOut(page);
  await enterPassword(page, "doe.jane");
  await expect(page.getByRole("alert")).toContainText(messages[language].signInRefused);
  await expect(page.getByTestId("account-identity")).toHaveCount(0);
  await activate(page.getByTestId("forgotten-credentials-link"));
  await expect(page.getByTestId("account-recovery-view")).toBeVisible();
  await writeInto(page.getByTestId("controlled-mfa-username"), "doe.jane");
  await writeInto(page.getByTestId("controlled-mfa-code"), code!);
  const newPassword = "clay-court-evening-restored";
  await writeInto(page.getByTestId("controlled-mfa-password"), newPassword);
  await writeInto(page.getByTestId("controlled-mfa-password-confirm"), newPassword);
  await activate(page.getByTestId("controlled-mfa-submit"));

  // then
  await expect(page.getByTestId("recovery-sent")).toBeVisible();
  await expect(page.getByTestId("controlled-mfa-code")).toHaveValue("");
  await expect(page.getByTestId("controlled-mfa-password")).toHaveValue("");
  await activate(page.getByTestId("recovery-back-to-login"));
  await expect(page.getByTestId("login-view")).toBeVisible();
  await signIn(page, "doe.jane", newPassword);
  await reachYourAccount(page);
  await expect(page.getByTestId("mfa-status")).toHaveText(messages[language].disabled);
  await expect(page.locator('[data-testid^="mfa-device-label-"]')).toHaveCount(0);
  await expect(page.getByTestId("mfa-recovery-remaining")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath(`mfa-recovered-${language}.png`), fullPage: true });
});
