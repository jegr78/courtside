import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import i18n from "../i18n";
import { MfaProofContext, ProofOwnerContext, WebauthnProofContext, reauthenticateForm } from "../security/reauthentication";
import { ReauthenticationCode } from "./ReauthenticationCode";

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});

it.each([false, true])("given MFA enabled is %s, when a sensitive dialog proves identity, then send the complete required proof", async (enabled) => {
  // given
  const prove = vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
  render(<MfaProofContext value={enabled}><form data-testid="proof-form" onSubmit={(event) => {
    event.preventDefault();
    void reauthenticateForm(event.currentTarget, "current-password");
  }}><ReauthenticationCode /></form></MfaProofContext>);
  // when
  if (enabled) await userEvent.type(screen.getByTestId("reauthentication-mfa-code"), "ABCD-EFGH-IJKL-MNOP-QRST-UVWX");
  else expect(screen.queryByTestId("reauthentication-mfa-code")).toBeNull();
  fireEvent.submit(screen.getByTestId("proof-form"));
  // then
  await waitFor(() => expect(prove).toHaveBeenCalledOnce());
  if (enabled) expect(prove).toHaveBeenCalledWith("current-password", "ABCD-EFGH-IJKL-MNOP-QRST-UVWX");
  else expect(prove).toHaveBeenCalledWith("current-password");
});

it.each(["de", "en"])("given locale %s, when the factor field appears, then show its translated label and permit password manager completion", async (locale) => {
  // given
  await i18n.changeLanguage(locale);
  // when
  render(<MfaProofContext value><ReauthenticationCode /></MfaProofContext>);
  // then
  const field = screen.getByTestId("reauthentication-mfa-code");
  expect(field).toHaveAccessibleName(i18n.t("mfa.code"));
  expect(field).toHaveAttribute("autocomplete", "one-time-code");
  expect(field).toBeRequired();
});

it("given a security key alternative, when proving identity, then send the password and assertion without a code", async () => {
  // given
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", class {});
  vi.stubGlobal("navigator", { credentials: { create: vi.fn(), get: vi.fn().mockResolvedValue({ id: "AQ", rawId: new Uint8Array([1]).buffer, type: "public-key", getClientExtensionResults: () => ({}), response: { authenticatorData: new Uint8Array([1]).buffer, clientDataJSON: new Uint8Array([2]).buffer, signature: new Uint8Array([3]).buffer, userHandle: null } }) } });
  vi.spyOn(api, "webauthnProofOptions").mockResolvedValue({ challenge: "AQ", rpId: "example.org", allowCredentials: [], userVerification: "required" });
  const prove = vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
  render(<MfaProofContext value><WebauthnProofContext value><form data-testid="proof-form" onSubmit={(event) => { event.preventDefault(); void reauthenticateForm(event.currentTarget, "current-password"); }}><ReauthenticationCode /></form></WebauthnProofContext></MfaProofContext>);
  // when
  fireEvent.click(screen.getByTestId("reauthentication-use-key"));
  fireEvent.submit(screen.getByTestId("proof-form"));
  // then
  await waitFor(() => expect(prove).toHaveBeenCalledOnce());
  expect(prove.mock.calls[0][0]).toBe("current-password");
  expect(prove.mock.calls[0][1]).toBeUndefined();
  expect(prove.mock.calls[0][2]?.response.signature).toBe("Aw");
  expect(screen.queryByTestId("reauthentication-mfa-code")).toBeNull();
  vi.unstubAllGlobals();
});

it("given a security key proof in progress, when the dialog unmounts, then abort the prompt and never submit a late proof", async () => {
  // given
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", class {});
  const get = vi.fn<(options: CredentialRequestOptions) => Promise<unknown>>().mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("navigator", { credentials: { create: vi.fn(), get } });
  vi.spyOn(api, "webauthnProofOptions").mockResolvedValue({ challenge: "AQ", rpId: "example.org", allowCredentials: [], userVerification: "required" });
  const prove = vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
  const failed = vi.fn();
  const shown = render(<MfaProofContext value><WebauthnProofContext value><form data-testid="proof-form" onSubmit={(event) => { event.preventDefault(); void reauthenticateForm(event.currentTarget, "current-password").catch(failed); }}><ReauthenticationCode /></form></WebauthnProofContext></MfaProofContext>);
  fireEvent.click(screen.getByTestId("reauthentication-use-key"));
  fireEvent.submit(screen.getByTestId("proof-form"));
  await waitFor(() => expect(get).toHaveBeenCalledOnce());
  // when
  shown.unmount();
  // then
  await waitFor(() => expect(failed).toHaveBeenCalledOnce());
  expect(get.mock.calls[0][0].signal?.aborted).toBe(true);
  expect(prove).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it.each(["escape", "owner", "code"])("given a security key proof, when cancellation comes from %s, then stop before submitting the password", async (cause) => {
  // given
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", class {});
  const get = vi.fn<(options: CredentialRequestOptions) => Promise<unknown>>().mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("navigator", { credentials: { create: vi.fn(), get } });
  vi.spyOn(api, "webauthnProofOptions").mockResolvedValue({ challenge: "AQ", rpId: "example.org", allowCredentials: [], userVerification: "required" });
  const prove = vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
  const failed = vi.fn();
  const content = (owner: string) => <ProofOwnerContext value={owner}><MfaProofContext value><WebauthnProofContext value><form data-testid="proof-form" onSubmit={(event) => { event.preventDefault(); void reauthenticateForm(event.currentTarget, "current-password").catch(failed); }}><ReauthenticationCode /></form></WebauthnProofContext></MfaProofContext></ProofOwnerContext>;
  const shown = render(content("jane.doe"));
  fireEvent.click(screen.getByTestId("reauthentication-use-key"));
  fireEvent.submit(screen.getByTestId("proof-form"));
  await waitFor(() => expect(get).toHaveBeenCalledOnce());
  // when
  if (cause === "escape") fireEvent.keyDown(window, { key: "Escape" });
  else if (cause === "owner") shown.rerender(content("john.roe"));
  else fireEvent.click(screen.getByTestId("reauthentication-use-code"));
  // then
  await waitFor(() => expect(failed).toHaveBeenCalledOnce());
  expect(get.mock.calls[0][0].signal?.aborted).toBe(true);
  expect(prove).not.toHaveBeenCalled();
  if (cause === "code") expect(screen.getByTestId("reauthentication-mfa-code")).toBeRequired();
  vi.unstubAllGlobals();
});
