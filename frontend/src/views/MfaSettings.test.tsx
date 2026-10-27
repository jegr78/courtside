import jsQR from "jsqr";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import i18n from "../i18n";
import { RecoveryCodesNotice } from "../components/RecoveryCodesNotice";
import { clearRecoveryCodes } from "../security/recoveryCodes";
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
  expect(confirm).toHaveBeenCalledWith("123456");
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
