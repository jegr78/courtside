import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { ProofOwnerContext } from "../security/reauthentication";
import { clearRecoveryCodes } from "../security/recoveryCodes";
import { WithClubConfiguration } from "../test/ClubConfiguration";
import { AccountSecurityView } from "./AccountSecurityView";

const operations = [
  { operation: "begin", button: "mfa-enroll-totp", path: "/api/account/mfa/totp", method: "POST" },
  { operation: "confirm", button: "mfa-confirm-totp", path: "/api/account/mfa/totp/confirmation", method: "POST" },
  { operation: "remove", button: "mfa-remove-totp", path: "/api/account/mfa/totp", method: "DELETE" },
  { operation: "recovery", button: "mfa-replace-recovery", path: "/api/account/mfa/recovery-codes", method: "POST" },
  { operation: "disable", button: "mfa-disable", path: "/api/account/mfa", method: "DELETE" }
];
const scenarios = operations.flatMap((operation) => [false, true].flatMap((proof) =>
  ["issue", "replay"].flatMap((stage) => [false, true].map((changed) => ({ ...operation, proof, stage, changed })))));

beforeEach(() => {
  vi.restoreAllMocks();
  document.cookie = "XSRF-TOKEN=initial";
  vi.spyOn(api, "accountSessions").mockResolvedValue([]);
  vi.spyOn(api, "ownMfa").mockResolvedValue({ enabled: true, totpEnabled: true, recoveryCodesRemaining: 4 });
  vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); clearRecoveryCodes(); document.cookie = "XSRF-TOKEN=; Max-Age=0"; });

it.each(scenarios)("given $operation with proof retry $proof and CSRF $stage, when actor replacement is $changed before the token arrives, then only the same actor can send the mutation", async ({ operation, button, path, method, proof, stage, changed }) => {
  // given
  if (operation === "confirm") vi.spyOn(api, "beginTotpEnrollment").mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP" });
  let mutations = 0;
  let finishToken!: (response: Response) => void;
  let waitingForToken = false;
  vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    if (url === "/api/session") {
      waitingForToken = true;
      return new Promise<Response>((resolve) => { finishToken = resolve; });
    }
    if (url !== path || init?.method !== method) throw new Error("Unexpected request");
    mutations += 1;
    if (proof && mutations === 1) return Promise.resolve(Response.json({ type: "urn:courtside:error:recent-authentication-required", title: "Proof required", status: 403 }, { status: 403, headers: { "Content-Type": "application/problem+json" } }));
    if (stage === "replay" && mutations === (proof ? 2 : 1)) {
      document.cookie = "XSRF-TOKEN=; Max-Age=0";
      return Promise.resolve(Response.json({ type: "urn:courtside:error:access-denied", title: "Token rotated", status: 403 }, { status: 403, headers: { "Content-Type": "application/problem+json" } }));
    }
    return Promise.resolve(operation === "begin" ? Response.json({ secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP" })
      : operation === "confirm" || operation === "recovery" ? Response.json({ codes: ["RECOVERY-CODE"] }) : new Response(null, { status: 204 }));
  });
  const signedOut = vi.fn();
  const content = (username: string) => <ProofOwnerContext value={username}><WithClubConfiguration><AccountSecurityView username={username} mfaEnabled passwordChanged={vi.fn()} signedOut={signedOut} /></WithClubConfiguration></ProofOwnerContext>;
  const shown = render(content("doe.jane"));
  await screen.findByTestId("mfa-enroll-totp");
  if (operation === "confirm") {
    fireEvent.click(screen.getByTestId("mfa-enroll-totp"));
    fireEvent.change(await screen.findByTestId("mfa-confirm-code"), { target: { value: "123456" } });
  }
  if (!proof && stage === "issue") document.cookie = "XSRF-TOKEN=; Max-Age=0";
  fireEvent.click(screen.getByTestId(button));
  if (proof) {
    await screen.findByRole("dialog");
    fireEvent.change(document.getElementById("reauthentication-password")!, { target: { value: "current-password" } });
    fireEvent.change(screen.getByTestId("reauthentication-mfa-code"), { target: { value: "123456" } });
    if (stage === "issue") document.cookie = "XSRF-TOKEN=; Max-Age=0";
    fireEvent.click(screen.getByTestId("reauthentication-submit"));
  }
  await waitFor(() => expect(waitingForToken).toBe(true));
  const alreadySent = (proof ? 1 : 0) + (stage === "replay" ? 1 : 0);
  expect(mutations).toBe(alreadySent);
  // when
  if (changed) shown.rerender(content("roe.john"));
  document.cookie = changed ? "XSRF-TOKEN=new-actor" : "XSRF-TOKEN=same-actor";
  await act(async () => { finishToken(Response.json({ authenticated: false, roles: [], passwordChangeRequired: false })); await new Promise((resolve) => setTimeout(resolve, 0)); });
  // then
  expect(mutations).toBe(alreadySent + (changed ? 0 : 1));
  if (changed) {
    expect(signedOut).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mfa-manual-key")).toBeNull();
    expect(screen.queryByTestId("mfa-recovery-codes")).toBeNull();
  } else if (operation === "begin") expect(await screen.findByTestId("mfa-manual-key")).toHaveTextContent("JBSWY3DPEHPK3PXP");
  else await waitFor(() => expect(signedOut).toHaveBeenCalledOnce());
});
