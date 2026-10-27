import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import i18n from "../i18n";
import { MfaProofContext, reauthenticateForm } from "../security/reauthentication";
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
