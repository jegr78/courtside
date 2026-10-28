import jsQR from "jsqr";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import i18n from "../i18n";
import { RecoveryCodesNotice } from "../components/RecoveryCodesNotice";
import { clearRecoveryCodes } from "../security/recoveryCodes";
import { MfaProofContext, WebauthnProofContext } from "../security/reauthentication";
import { WithClubConfiguration } from "../test/ClubConfiguration";
import { AccountSecurityView } from "./AccountSecurityView";

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
  vi.spyOn(api, "accountSessions").mockResolvedValue([]);
  vi.spyOn(api, "ownMfa").mockResolvedValue({ enabled: false, totpEnabled: false, recoveryCodesRemaining: 0 });
});
afterEach(clearRecoveryCodes);

function show(enabled = false, signedOut = vi.fn()) {
  return render(<WithClubConfiguration>
    <AccountSecurityView username="doe.jane" mfaEnabled={enabled} passwordChanged={vi.fn()} signedOut={signedOut} />
    <RecoveryCodesNotice session={{ authenticated: true, username: "doe.jane", roles: ["MEMBER"], passwordChangeRequired: false }} signedOut={signedOut} />
  </WithClubConfiguration>);
}

it("given missing fresh proof, when beginning enrollment, then retry after password proof and show QR and manual key", async () => {
  // given
  const enroll = vi.spyOn(api, "beginTotpEnrollment")
    .mockRejectedValueOnce(new ApiError(403, { type: "urn:courtside:error:recent-authentication-required", status: 403, title: "Proof required" }))
    .mockResolvedValue({ secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", uri: "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" });
  const prove = vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
  show();
  // when
  await userEvent.click(await screen.findByTestId("mfa-enroll-totp"));
  await userEvent.type(document.getElementById("reauthentication-password")!, "current-password");
  await userEvent.click(screen.getByTestId("reauthentication-submit"));
  // then
  expect(await screen.findByTestId("mfa-manual-key")).toHaveTextContent("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP");
  const qr = screen.getByTestId("mfa-qr");
  expect(qr.tagName.toLowerCase()).toBe("svg");
  expect(qr.querySelector("path")?.getAttribute("d")?.length).toBeGreaterThan(1000);
  expect(qr.querySelector("image")).toBeNull();
  const side = Number(qr.getAttribute("viewBox")!.split(" ")[2]);
  const pixels = new Uint8ClampedArray(side * side * 8 * 8 * 4).fill(255);
  for (const cell of qr.querySelector("path")!.getAttribute("d")!.matchAll(/M(\d+),(\d+)h1v1h-1z/g)) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const offset = ((Number(cell[2]) * 8 + y) * side * 8 + Number(cell[1]) * 8 + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
    }
  }
  expect(jsQR(pixels, side * 8, side * 8)?.data).toBe("otpauth://totp/Example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP");
  expect(prove).toHaveBeenCalledWith("current-password");
  expect(enroll).toHaveBeenCalledTimes(2);
});

it("given confirmed enrollment, when sessions end, then codes remain until the holder acknowledges saving them", async () => {
  // given
  vi.spyOn(api, "beginTotpEnrollment").mockResolvedValue({ secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", uri: "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" });
  const confirm = vi.spyOn(api, "confirmTotpEnrollment").mockResolvedValue({ codes: ["ABCD-EFGH-IJKL-MNOP-QRST-UVWX", "BCDE-FGHI-JKLM-NOPQ-RSTU-VWXY"] });
  const storage = vi.spyOn(Storage.prototype, "setItem");
  const signedOut = vi.fn();
  const shown = show(false, signedOut);
  await userEvent.click(await screen.findByTestId("mfa-enroll-totp"));
  await userEvent.type(await screen.findByTestId("mfa-confirm-code"), "123456");
  // when
  await userEvent.click(screen.getByTestId("mfa-confirm-totp"));
  await screen.findByTestId("mfa-recovery-codes");
  shown.rerender(<RecoveryCodesNotice session={{ authenticated: false, roles: [], passwordChangeRequired: false }} signedOut={signedOut} />);
  fireEvent(window, new Event("focus"));
  await userEvent.keyboard("{Escape}");
  // then
  expect(screen.getByTestId("mfa-recovery-codes")).toHaveTextContent("ABCD-EFGH-IJKL-MNOP-QRST-UVWX");
  expect(confirm).toHaveBeenCalledWith("123456", expect.any(AbortSignal));
  expect(JSON.stringify(storage.mock.calls)).not.toContain("ABCD-EFGH");
  await userEvent.click(screen.getByTestId("mfa-codes-saved"));
  expect(screen.queryByTestId("mfa-recovery-codes")).toBeNull();
  expect(signedOut).toHaveBeenCalled();
});

it("given MFA protects an action, when fresh proof is required, then submit password and recovery code together", async () => {
  // given
  vi.mocked(api.ownMfa).mockResolvedValue({ enabled: true, totpEnabled: true, recoveryCodesRemaining: 4 });
  const disable = vi.spyOn(api, "disableMfa").mockRejectedValueOnce(new ApiError(403, { type: "urn:courtside:error:recent-authentication-required", title: "Proof required", status: 403 })).mockResolvedValue(undefined);
  const prove = vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
  const signedOut = vi.fn();
  show(true, signedOut);
  // when
  await userEvent.click(await screen.findByTestId("mfa-disable"));
  await userEvent.click(screen.getByTestId("mfa-confirm-removal"));
  await userEvent.type(document.getElementById("reauthentication-password")!, "current-password");
  await userEvent.type(screen.getByTestId("reauthentication-mfa-code"), "ABCD-EFGH-IJKL-MNOP-QRST-UVWX");
  await userEvent.click(screen.getByTestId("reauthentication-submit"));
  // then
  await waitFor(() => expect(disable).toHaveBeenCalledTimes(2));
  expect(prove).toHaveBeenCalledWith("current-password", "ABCD-EFGH-IJKL-MNOP-QRST-UVWX");
  expect(signedOut).toHaveBeenCalledOnce();
});

it("given an enrollment response from an old account, when the account view unmounts, then never expose its key", async () => {
  // given
  let finish!: (value: { secret: string; uri: string }) => void;
  vi.spyOn(api, "beginTotpEnrollment").mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const shown = show();
  await userEvent.click(await screen.findByTestId("mfa-enroll-totp"));
  // when
  shown.unmount();
  finish({ secret: "OLD-ACCOUNT-KEY", uri: "otpauth://totp/Old" });
  // then
  await waitFor(() => expect(screen.queryByTestId("mfa-manual-key")).toBeNull());
});

it("given a factor confirmation in flight, when the form submits twice, then send one confirmation", async () => {
  // given
  vi.spyOn(api, "beginTotpEnrollment").mockResolvedValue({ secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", uri: "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" });
  const confirm = vi.spyOn(api, "confirmTotpEnrollment").mockImplementation(() => new Promise(() => undefined));
  show();
  await userEvent.click(await screen.findByTestId("mfa-enroll-totp"));
  const field = await screen.findByTestId("mfa-confirm-code");
  await userEvent.type(field, "123456");
  const form = field.closest("form")!;
  // when
  fireEvent.submit(form);
  fireEvent.submit(form);
  // then
  expect(confirm).toHaveBeenCalledOnce();
});


it("given a rejected test code, when confirming enrollment, then keep the unactivated setup visible without publishing recovery codes", async () => {
  // given
  vi.spyOn(api, "beginTotpEnrollment").mockResolvedValue({ secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", uri: "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" });
  vi.spyOn(api, "confirmTotpEnrollment").mockRejectedValue(new ApiError(403, { type: "urn:courtside:error:mfa-proof-failed", detail: "identity.mfa.proofFailed", status: 403, title: "Proof failed" }));
  const signedOut = vi.fn();
  show(false, signedOut);
  await userEvent.click(await screen.findByTestId("mfa-enroll-totp"));
  await userEvent.type(await screen.findByTestId("mfa-confirm-code"), "000000");
  // when
  await userEvent.click(screen.getByTestId("mfa-confirm-totp"));
  // then
  expect(await screen.findByTestId("account-security-failure")).toBeInTheDocument();
  expect(screen.getByTestId("mfa-manual-key")).toBeInTheDocument();
  expect(screen.queryByTestId("mfa-recovery-codes")).toBeNull();
  expect(signedOut).not.toHaveBeenCalled();
});

it("given existing MFA, when replacing recovery codes, then display only the new set before sign-in", async () => {
  // given
  vi.mocked(api.ownMfa).mockResolvedValue({ enabled: true, totpEnabled: true, recoveryCodesRemaining: 4 });
  const replace = vi.spyOn(api, "replaceRecoveryCodes").mockResolvedValue({ codes: ["NEW-RECOVERY-CODE"] });
  const signedOut = vi.fn();
  show(true, signedOut);
  // when
  await userEvent.click(await screen.findByTestId("mfa-replace-recovery"));
  // then
  expect(await screen.findByTestId("mfa-recovery-codes")).toHaveTextContent("NEW-RECOVERY-CODE");
  expect(replace).toHaveBeenCalledOnce();
  expect(signedOut).toHaveBeenCalledOnce();
});

it("given an enrolled authenticator, when removing it, then end this session without inventing a new recovery set", async () => {
  // given
  vi.mocked(api.ownMfa).mockResolvedValue({ enabled: true, totpEnabled: true, recoveryCodesRemaining: 4 });
  const remove = vi.spyOn(api, "removeTotp").mockResolvedValue(undefined);
  const signedOut = vi.fn();
  show(true, signedOut);
  // when
  await userEvent.click(await screen.findByTestId("mfa-remove-totp"));
  await userEvent.click(within(screen.getByRole("dialog")).getByTestId("mfa-confirm-removal"));
  // then
  expect(remove).toHaveBeenCalledOnce();
  expect(signedOut).toHaveBeenCalledOnce();
  expect(screen.queryByTestId("mfa-recovery-codes")).toBeNull();
});

it("given another account signs in, when a previous recovery set is still in memory, then clear it before rendering", async () => {
  // given
  vi.mocked(api.ownMfa).mockResolvedValue({ enabled: true, totpEnabled: true, recoveryCodesRemaining: 4 });
  vi.spyOn(api, "replaceRecoveryCodes").mockResolvedValue({ codes: ["OLD-ACCOUNT-RECOVERY-CODE"] });
  const shown = show(true);
  await userEvent.click(await screen.findByTestId("mfa-replace-recovery"));
  await screen.findByTestId("mfa-recovery-codes");
  // when
  shown.rerender(<RecoveryCodesNotice session={{ authenticated: true, username: "roe.john", roles: ["MEMBER"], passwordChangeRequired: false }} signedOut={vi.fn()} />);
  // then
  expect(screen.queryByTestId("mfa-recovery-codes")).toBeNull();
});

it("given available security keys, when registering a labelled device, then send its attestation and show the first recovery set", async () => {
  // given
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", class {});
  vi.stubGlobal("navigator", { credentials: { create: vi.fn().mockResolvedValue({ id: "AQ", rawId: new Uint8Array([1]).buffer, type: "public-key", getClientExtensionResults: () => ({}), response: { attestationObject: new Uint8Array([2]).buffer, clientDataJSON: new Uint8Array([3]).buffer, getTransports: () => ["usb"] } }), get: vi.fn() } });
  vi.mocked(api.ownMfa).mockResolvedValue({ enabled: false, totpEnabled: false, recoveryCodesRemaining: 0, webauthnAvailable: true, devices: [] });
  vi.spyOn(api, "webauthnRegistrationOptions").mockResolvedValue({ rp: { id: "example.org", name: "Example" }, user: { id: "AQ", name: "jane.doe", displayName: "Jane Doe" }, challenge: "Ag", pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { userVerification: "required" } });
  const register = vi.spyOn(api, "registerWebauthn").mockResolvedValue({ codes: ["FIRST-RECOVERY-CODE"] });
  show();
  // when
  fireEvent.change(await screen.findByTestId("mfa-key-label"), { target: { value: "Travel key" } });
  fireEvent.click(screen.getByTestId("mfa-add-key"));
  // then
  expect(await screen.findByTestId("mfa-recovery-codes")).toHaveTextContent("FIRST-RECOVERY-CODE");
  expect(register.mock.calls[0][0]).toBe("Travel key");
  expect(register.mock.calls[0][1].response.attestationObject).toBe("Ag");
  vi.unstubAllGlobals();
});

it("given private enrolled devices, when correcting a label and removing a device, then address only the selected credential", async () => {
  // given
  vi.mocked(api.ownMfa).mockResolvedValue({ enabled: true, totpEnabled: false, recoveryCodesRemaining: 4, devices: [{ id: "AQ", label: "Old label", createdAt: "2026-10-01T12:00:00Z", lastUsedAt: "2026-10-01T12:00:00Z" }, { id: "Ag", label: "Spare key", createdAt: "2026-10-01T12:00:00Z", lastUsedAt: "2026-10-01T12:00:00Z" }] });
  const rename = vi.spyOn(api, "renameWebauthn").mockResolvedValue(undefined);
  const remove = vi.spyOn(api, "removeWebauthn").mockResolvedValue(undefined);
  const signedOut = vi.fn();
  show(true, signedOut);
  // when
  fireEvent.change(await screen.findByTestId("mfa-device-label-AQ"), { target: { value: "Travel key" } });
  fireEvent.click(screen.getByTestId("mfa-device-rename-AQ"));
  await waitFor(() => expect(rename).toHaveBeenCalledWith("AQ", "Travel key", expect.any(AbortSignal)));
  fireEvent.click(screen.getByTestId("mfa-device-remove-Ag"));
  fireEvent.click(within(await screen.findByRole("dialog")).getByTestId("mfa-confirm-removal"));
  // then
  await waitFor(() => expect(remove).toHaveBeenCalledWith("Ag", expect.any(AbortSignal)));
  expect(signedOut).toHaveBeenCalledTimes(2);
});

it("given a device registration prompt, when the account view unmounts, then cancel without submitting or exposing recovery codes", async () => {
  // given
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", class {});
  const create = vi.fn<(options: CredentialCreationOptions) => Promise<unknown>>().mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("navigator", { credentials: { create, get: vi.fn() } });
  vi.mocked(api.ownMfa).mockResolvedValue({ enabled: false, totpEnabled: false, recoveryCodesRemaining: 0, webauthnAvailable: true, devices: [] });
  vi.spyOn(api, "webauthnRegistrationOptions").mockResolvedValue({ rp: { id: "example.org", name: "Example" }, user: { id: "AQ", name: "jane.doe", displayName: "Jane Doe" }, challenge: "Ag", pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { userVerification: "required" } });
  const register = vi.spyOn(api, "registerWebauthn").mockResolvedValue({ codes: ["FIRST-RECOVERY-CODE"] });
  const shown = show();
  fireEvent.change(await screen.findByTestId("mfa-key-label"), { target: { value: "Travel key" } });
  fireEvent.click(screen.getByTestId("mfa-add-key"));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  // when
  shown.unmount();
  // then
  expect(create.mock.calls[0][0].signal?.aborted).toBe(true);
  expect(register).not.toHaveBeenCalled();
  expect(screen.queryByTestId("mfa-recovery-codes")).toBeNull();
  vi.unstubAllGlobals();
});

it("given an unsupported browser, when the holder opens security settings, then explain key requirements and keep authenticator setup usable", async () => {
  // given
  vi.stubGlobal("isSecureContext", false);
  vi.mocked(api.ownMfa).mockResolvedValue({ enabled: false, totpEnabled: false, recoveryCodesRemaining: 0, webauthnAvailable: true });
  // when
  show();
  // then
  expect(await screen.findByTestId("mfa-key-unavailable")).toHaveTextContent(i18n.t("mfa.keyUnavailable"));
  expect(screen.queryByTestId("mfa-add-key")).toBeNull();
  expect(screen.getByTestId("mfa-enroll-totp")).toBeEnabled();
  vi.unstubAllGlobals();
});

it("given an exposed authenticator setup, when another account replaces the view, then clear the previous account key before rendering", async () => {
  // given
  vi.spyOn(api, "beginTotpEnrollment").mockResolvedValue({ secret: "OLD-ACCOUNT-KEY", uri: "otpauth://totp/Old" });
  const shown = show();
  await userEvent.click(await screen.findByTestId("mfa-enroll-totp"));
  await screen.findByTestId("mfa-manual-key");
  // when
  shown.rerender(<WithClubConfiguration><AccountSecurityView username="roe.john" mfaEnabled={false} passwordChanged={vi.fn()} signedOut={vi.fn()} /></WithClubConfiguration>);
  // then
  expect(screen.queryByTestId("mfa-manual-key")).toBeNull();
});

it("given password proof retries device enrollment, when the proof dialog closes during the native prompt, then cancel before sending enrollment", async () => {
  // given
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", class {});
  let finish!: (credential: unknown) => void;
  const create = vi.fn<(options: CredentialCreationOptions) => Promise<unknown>>().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal("navigator", { credentials: { create, get: vi.fn() } });
  vi.mocked(api.ownMfa).mockResolvedValue({ enabled: false, totpEnabled: false, recoveryCodesRemaining: 0, webauthnAvailable: true });
  vi.spyOn(api, "webauthnRegistrationOptions").mockRejectedValueOnce(new ApiError(403, { type: "urn:courtside:error:recent-authentication-required", status: 403, title: "Proof required" })).mockResolvedValue({ rp: { id: "example.org", name: "Example" }, user: { id: "AQ", name: "jane.doe", displayName: "Jane Doe" }, challenge: "Ag", pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { userVerification: "required" } });
  vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
  const register = vi.spyOn(api, "registerWebauthn").mockResolvedValue({ codes: ["FIRST-RECOVERY-CODE"] });
  const signedOut = vi.fn();
  show(false, signedOut);
  fireEvent.change(await screen.findByTestId("mfa-key-label"), { target: { value: "Travel key" } });
  fireEvent.click(screen.getByTestId("mfa-add-key"));
  await screen.findByRole("dialog");
  await userEvent.type(document.getElementById("reauthentication-password")!, "current-password");
  fireEvent.click(screen.getByTestId("reauthentication-submit"));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  // when
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await act(async () => { finish({ id: "AQ", rawId: new Uint8Array([1]).buffer, type: "public-key", getClientExtensionResults: () => ({}), response: { attestationObject: new Uint8Array([2]).buffer, clientDataJSON: new Uint8Array([3]).buffer, getTransports: () => ["usb"] } }); await Promise.resolve(); });
  // then
  expect(create.mock.calls[0][0].signal?.aborted).toBe(true);
  expect(register).not.toHaveBeenCalled();
  expect(signedOut).not.toHaveBeenCalled();
  expect(screen.queryByTestId("mfa-recovery-codes")).toBeNull();
  vi.unstubAllGlobals();
});

it("given proof has already submitted device enrollment, when the proof dialog closes, then deliver the committed recovery codes", async () => {
  // given
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", class {});
  vi.stubGlobal("navigator", { credentials: { create: vi.fn().mockResolvedValue({ id: "AQ", rawId: new Uint8Array([1]).buffer, type: "public-key", getClientExtensionResults: () => ({}), response: { attestationObject: new Uint8Array([2]).buffer, clientDataJSON: new Uint8Array([3]).buffer, getTransports: () => ["usb"] } }), get: vi.fn() } });
  vi.mocked(api.ownMfa).mockResolvedValue({ enabled: false, totpEnabled: false, recoveryCodesRemaining: 0, webauthnAvailable: true });
  vi.spyOn(api, "webauthnRegistrationOptions").mockRejectedValueOnce(new ApiError(403, { type: "urn:courtside:error:recent-authentication-required", status: 403, title: "Proof required" })).mockResolvedValue({ rp: { id: "example.org", name: "Example" }, user: { id: "AQ", name: "jane.doe", displayName: "Jane Doe" }, challenge: "Ag", pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { userVerification: "required" } });
  vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
  let finish!: (result: { codes: string[] }) => void;
  const register = vi.spyOn(api, "registerWebauthn").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const signedOut = vi.fn();
  show(false, signedOut);
  fireEvent.change(await screen.findByTestId("mfa-key-label"), { target: { value: "Travel key" } });
  fireEvent.click(screen.getByTestId("mfa-add-key"));
  await screen.findByRole("dialog");
  await userEvent.type(document.getElementById("reauthentication-password")!, "current-password");
  fireEvent.click(screen.getByTestId("reauthentication-submit"));
  await waitFor(() => expect(register).toHaveBeenCalledOnce());
  // when
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await act(async () => { finish({ codes: ["COMMITTED-RECOVERY-CODE"] }); await Promise.resolve(); });
  // then
  expect(register.mock.calls[0][2]?.aborted).toBe(false);
  expect(await screen.findByTestId("mfa-recovery-codes")).toHaveTextContent("COMMITTED-RECOVERY-CODE");
  expect(signedOut).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});

function keyRegistration(create: (options: CredentialCreationOptions) => Promise<unknown>) {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", class {});
  vi.stubGlobal("navigator", { credentials: { create, get: vi.fn() } });
  vi.mocked(api.ownMfa).mockResolvedValue({ enabled: false, totpEnabled: false, recoveryCodesRemaining: 0, webauthnAvailable: true, devices: [] });
  vi.spyOn(api, "webauthnRegistrationOptions").mockResolvedValue({ rp: { id: "example.org", name: "Example" }, user: { id: "AQ", name: "jane.doe", displayName: "Jane Doe" }, challenge: "Ag", pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { userVerification: "required" } });
  return vi.spyOn(api, "registerWebauthn").mockResolvedValue({ codes: ["FIRST-RECOVERY-CODE"] });
}

it.each([
  ["NotAllowedError", "mfa.keyCancelled"],
  ["InvalidStateError", "mfa.keyAlreadyRegistered"]
])("given the browser answers a key registration with %s, when the holder adds a key, then exactly one alert explains it without a status retry", async (name, key) => {
  // given
  const register = keyRegistration(() => Promise.reject(new DOMException("refused", name)));
  show();
  // when
  fireEvent.change(await screen.findByTestId("mfa-key-label"), { target: { value: "Travel key" } });
  fireEvent.click(screen.getByTestId("mfa-add-key"));
  // then
  await waitFor(() => expect(screen.getByTestId("mfa-add-key")).toBeEnabled());
  const alerts = screen.getAllByRole("alert");
  expect(alerts, "a single alert reports the key outcome").toHaveLength(1);
  expect(alerts[0]).toHaveTextContent(i18n.t(key));
  expect(screen.queryByTestId("mfa-retry"), "reloading the status cannot repeat a key request").toBeNull();
  expect(register).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it("given a key registration prompt, when the holder presses cancel, then exactly one alert says it was cancelled", async () => {
  // given
  const register = keyRegistration((options) => new Promise((_, reject) => {
    options.signal?.addEventListener("abort", () => reject(new DOMException("Security key request cancelled", "AbortError")));
  }));
  show();
  fireEvent.change(await screen.findByTestId("mfa-key-label"), { target: { value: "Travel key" } });
  fireEvent.click(screen.getByTestId("mfa-add-key"));
  // when
  fireEvent.click(await screen.findByTestId("mfa-cancel-key"));
  // then
  await waitFor(() => expect(screen.getByTestId("mfa-add-key")).toBeEnabled());
  const alerts = screen.getAllByRole("alert");
  expect(alerts, "a single alert reports the cancellation").toHaveLength(1);
  expect(alerts[0]).toHaveTextContent(i18n.t("mfa.keyCancelled"));
  expect(screen.queryByTestId("mfa-retry")).toBeNull();
  expect(register).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it.each([
  ["NotAllowedError", "mfa.keyCancelled"],
  ["TimeoutError", "mfa.keyTimedOut"]
])("given a security key proof answered with %s, when the holder proves identity, then the proof dialog explains it", async (name, key) => {
  // given
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", class {});
  vi.stubGlobal("navigator", { credentials: { create: vi.fn(), get: vi.fn().mockRejectedValue(new DOMException("refused", name)) } });
  vi.mocked(api.ownMfa).mockResolvedValue({ enabled: true, totpEnabled: true, recoveryCodesRemaining: 4 });
  vi.spyOn(api, "replaceRecoveryCodes").mockRejectedValue(new ApiError(403, { type: "urn:courtside:error:recent-authentication-required", status: 403, title: "Proof required" }));
  vi.spyOn(api, "webauthnProofOptions").mockResolvedValue({ challenge: "AQ", rpId: "example.org", allowCredentials: [], userVerification: "required" });
  const prove = vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
  render(<WithClubConfiguration><MfaProofContext value><WebauthnProofContext value>
    <AccountSecurityView username="doe.jane" mfaEnabled passwordChanged={vi.fn()} signedOut={vi.fn()} />
  </WebauthnProofContext></MfaProofContext></WithClubConfiguration>);
  await userEvent.click(await screen.findByTestId("mfa-replace-recovery"));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(document.getElementById("reauthentication-password")!, "current-password");
  await userEvent.click(within(dialog).getByTestId("reauthentication-use-key"));
  // when
  await userEvent.click(within(dialog).getByTestId("reauthentication-submit"));
  // then
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(i18n.t(key));
  expect(prove).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const removals = [
  ["mfa-disable", "disableMfa"],
  ["mfa-remove-totp", "removeTotp"],
  ["mfa-device-remove-AQ", "removeWebauthn"]
] as const;

it.each(removals)("given recent proof, when the holder presses %s and cancels, then nothing is removed and no session ends", async (trigger, operation) => {
  // given
  vi.mocked(api.ownMfa).mockResolvedValue({ enabled: true, totpEnabled: true, recoveryCodesRemaining: 4, devices: [{ id: "AQ", label: "Travel key", createdAt: "2026-10-01T12:00:00Z", lastUsedAt: "2026-10-01T12:00:00Z" }] });
  const remove = vi.spyOn(api, operation).mockResolvedValue(undefined);
  const signedOut = vi.fn();
  show(true, signedOut);
  // when
  await userEvent.click(await screen.findByTestId(trigger));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByTestId("mfa-cancel-removal"));
  // then
  expect(remove, "pressing the button alone removes nothing").not.toHaveBeenCalled();
  expect(signedOut).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each(removals)("given recent proof, when the holder presses %s and confirms, then the protection is removed once and the session ends", async (trigger, operation) => {
  // given
  vi.mocked(api.ownMfa).mockResolvedValue({ enabled: true, totpEnabled: true, recoveryCodesRemaining: 4, devices: [{ id: "AQ", label: "Travel key", createdAt: "2026-10-01T12:00:00Z", lastUsedAt: "2026-10-01T12:00:00Z" }] });
  const remove = vi.spyOn(api, operation).mockResolvedValue(undefined);
  const signedOut = vi.fn();
  show(true, signedOut);
  await userEvent.click(await screen.findByTestId(trigger));
  const dialog = screen.getByRole("dialog");
  expect(remove, "the confirmation comes before the request").not.toHaveBeenCalled();
  // when
  await userEvent.click(within(dialog).getByTestId("mfa-confirm-removal"));
  // then
  await waitFor(() => expect(remove).toHaveBeenCalledOnce());
  expect(signedOut).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("given a security key, when its removal is asked for, then the confirmation names that key", async () => {
  // given
  vi.mocked(api.ownMfa).mockResolvedValue({ enabled: true, totpEnabled: false, recoveryCodesRemaining: 4, devices: [{ id: "AQ", label: "Travel key", createdAt: "2026-10-01T12:00:00Z", lastUsedAt: "2026-10-01T12:00:00Z" }] });
  show(true);
  // when
  await userEvent.click(await screen.findByTestId("mfa-device-remove-AQ"));
  // then
  expect(screen.getByRole("dialog")).toHaveTextContent(i18n.t("mfa.confirmRemoveKeyExplain", { label: "Travel key" }));
});
