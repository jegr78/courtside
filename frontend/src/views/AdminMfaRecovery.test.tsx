import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import i18n from "../i18n";
import { AdminMfaRecovery } from "./AdminMfaRecovery";

beforeEach(async () => { vi.restoreAllMocks(); await i18n.changeLanguage("en"); });

it("given an MFA account, when starting recovery, then require the identity check and expose only the administrative status", async () => {
  // given
  vi.spyOn(api, "accountMfa").mockResolvedValue({ enabled: true, recoveryPending: false });
  const recover = vi.spyOn(api, "recoverAccountMfa").mockResolvedValue(undefined);
  const run = vi.fn(async (action: () => Promise<void>) => action());
  render(<AdminMfaRecovery accountId="account-1" disabled={false} run={run} />);
  const button = await screen.findByTestId("admin-mfa-recover");
  expect(button).toBeDisabled();
  // when
  fireEvent.click(screen.getByTestId("admin-mfa-identity-checked"));
  fireEvent.click(button);
  // then
  await waitFor(() => expect(recover).toHaveBeenCalledWith("account-1", expect.any(AbortSignal)));
  expect(run).toHaveBeenCalledOnce();
  expect(screen.getByTestId("admin-mfa-status")).toHaveTextContent(i18n.t("mfa.adminRecoveryPending"));
  expect(screen.queryByTestId("mfa-device-list")).toBeNull();
});

it("given an account without MFA, when loading its administrative status, then do not offer an unnecessary recovery", async () => {
  // given
  vi.spyOn(api, "accountMfa").mockResolvedValue({ enabled: false, recoveryPending: false });
  // when
  render(<AdminMfaRecovery accountId="account-1" disabled={false} run={vi.fn()} />);
  // then
  expect(await screen.findByTestId("admin-mfa-status")).toHaveTextContent(i18n.t("mfa.disabled"));
  expect(screen.queryByTestId("admin-mfa-recover")).toBeNull();
});

it("given a delayed account status, when another account opens, then discard the previous account response", async () => {
  // given
  let finish!: (value: { enabled: boolean; recoveryPending: boolean }) => void;
  vi.spyOn(api, "accountMfa").mockImplementation((id) => id === "account-1" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ enabled: false, recoveryPending: false }));
  const shown = render(<AdminMfaRecovery accountId="account-1" disabled={false} run={vi.fn()} />);
  // when
  shown.rerender(<AdminMfaRecovery accountId="account-2" disabled={false} run={vi.fn()} />);
  finish({ enabled: true, recoveryPending: true });
  // then
  expect(await screen.findByTestId("admin-mfa-status")).toHaveTextContent(i18n.t("mfa.disabled"));
  expect(screen.queryByTestId("admin-mfa-recover")).toBeNull();
});
