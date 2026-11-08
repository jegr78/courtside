import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type PayPalConnectionCheckResult, type PayPalSettings } from "../api/client";
import i18n from "../i18n";
import { formatDateTime } from "../time/clubZone";
import { WithClubConfiguration } from "../test/ClubConfiguration";
import { UnsavedChangesProvider } from "../unsaved/UnsavedChangesProvider";
import { AdminPayPalView } from "./AdminPayPalView";

const storedAt = "2026-11-08T10:00:00Z";
const nothingStored: PayPalSettings = { clientId: null, environment: "SANDBOX", enabled: false, secretStoredAt: null };
const stored: PayPalSettings = { clientId: "client-1", environment: "SANDBOX", enabled: true, secretStoredAt: storedAt };
const recentAuthenticationRequired = () => new ApiError(403,
  { type: "urn:courtside:error:recent-authentication-required", title: "Recent authentication required", status: 403 });

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});

function show(wrapper?: ({ children }: { children: ReactNode }) => ReactNode) {
  const Owner = wrapper ?? (({ children }: { children: ReactNode }) => children);
  return render(<MemoryRouter><WithClubConfiguration><UnsavedChangesProvider><Owner>
    <AdminPayPalView />
  </Owner></UnsavedChangesProvider></WithClubConfiguration></MemoryRouter>);
}

async function opened(settings: PayPalSettings) {
  vi.spyOn(api, "payPalSettings").mockResolvedValue(settings);
  show();
  await screen.findByTestId("paypal-form");
}

it("given a stored secret, when the page opens, then the form shows the settings, an empty secret field and since when the secret is stored", async () => {
  // when
  await opened(stored);

  // then
  expect(screen.getByTestId("paypal-client-id")).toHaveValue("client-1");
  expect(screen.getByTestId("paypal-environment-SANDBOX")).toBeChecked();
  expect(screen.getByTestId("paypal-enabled")).toBeChecked();
  expect(screen.getByTestId("paypal-secret"), "the secret never comes back").toHaveValue("");
  const state = screen.getByTestId("paypal-secret-state");
  expect(state).toHaveAttribute("data-stored", "true");
  expect(state).toHaveTextContent(i18n.t("admin.paypal.secretStoredSince", { dateTime: formatDateTime(storedAt, "en", "Pacific/Auckland") }));
  expect(state).not.toHaveTextContent(storedAt);
});

it("given no credentials, when the page opens, then no secret is reported and nothing can be removed", async () => {
  // when
  await opened(nothingStored);

  // then
  const state = screen.getByTestId("paypal-secret-state");
  expect(state).toHaveAttribute("data-stored", "false");
  expect(state).toHaveTextContent(i18n.t("admin.paypal.secretMissing"));
  expect(screen.queryByTestId("paypal-remove")).not.toBeInTheDocument();
});

it("given a stored secret, when the settings are saved with an empty secret field, then the request leaves the secret out", async () => {
  // given
  const save = vi.spyOn(api, "savePayPalSettings").mockResolvedValue({ ...stored, environment: "LIVE", enabled: false });
  await opened(stored);

  // when
  await userEvent.click(screen.getByTestId("paypal-environment-LIVE"));
  await userEvent.click(screen.getByTestId("paypal-enabled"));
  await userEvent.click(screen.getByTestId("paypal-save"));

  // then
  expect(await screen.findByTestId("paypal-form-success")).toBeInTheDocument();
  expect(save).toHaveBeenCalledOnce();
  const sent = save.mock.calls[0][0];
  expect(sent).toStrictEqual({ clientId: "client-1", environment: "LIVE", enabled: false });
  expect(Object.keys(sent), "an empty field keeps the stored secret").not.toContain("secret");
  expect(screen.getByTestId("paypal-environment-LIVE")).toBeChecked();
});

it("given a new secret, when the settings are saved, then the secret is sent and the field is empty afterwards", async () => {
  // given
  const save = vi.spyOn(api, "savePayPalSettings").mockResolvedValue({ ...stored, clientId: "client-2" });
  await opened(nothingStored);

  // when
  await userEvent.type(screen.getByTestId("paypal-client-id"), "client-2");
  await userEvent.type(screen.getByTestId("paypal-secret"), "secret-value");
  await userEvent.click(screen.getByTestId("paypal-save"));

  // then
  expect(await screen.findByTestId("paypal-form-success")).toBeInTheDocument();
  expect(save).toHaveBeenCalledWith({ clientId: "client-2", environment: "SANDBOX", enabled: false, secret: "secret-value" });
  expect(screen.getByTestId("paypal-secret"), "a saved secret is not kept in the page").toHaveValue("");
  expect(screen.getByTestId("paypal-secret-state")).toHaveAttribute("data-stored", "true");
});

it("given no stored secret, when PayPal is switched on without one, then the refusal asks for one and the form keeps its input", async () => {
  // given
  vi.spyOn(api, "savePayPalSettings").mockRejectedValue(new ApiError(409, {
    type: "urn:courtside:error:paypal-secret-required", title: "PayPal secret required", status: 409,
    violations: [{ code: "payment.paypal.secretRequired", params: {} }]
  }));
  await opened(nothingStored);

  // when
  await userEvent.type(screen.getByTestId("paypal-client-id"), "client-2");
  await userEvent.click(screen.getByTestId("paypal-save"));

  // then
  expect(await screen.findByTestId("paypal-form-error")).toHaveTextContent(i18n.t("payment.paypal.secretRequired"));
  expect(screen.getByTestId("paypal-client-id")).toHaveValue("client-2");
  expect(screen.queryByTestId("paypal-form-success")).not.toBeInTheDocument();
});

it("given an empty client id, when the settings are saved, then nothing is sent and the field is refused", async () => {
  // given
  const save = vi.spyOn(api, "savePayPalSettings");
  await opened(nothingStored);

  // when
  await userEvent.type(screen.getByTestId("paypal-client-id"), "   ");
  await userEvent.click(screen.getByTestId("paypal-save"));

  // then
  expect(await screen.findByTestId("paypal-form-error")).toHaveTextContent(i18n.t("admin.paypal.clientIdRequired"));
  expect(save).not.toHaveBeenCalled();
});

it("given a save that needs a fresh proof, when the treasurer confirms the password, then the same settings are sent again", async () => {
  // given
  const proved = vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
  const save = vi.spyOn(api, "savePayPalSettings").mockRejectedValueOnce(recentAuthenticationRequired()).mockResolvedValueOnce(stored);
  await opened(stored);
  await userEvent.type(screen.getByTestId("paypal-secret"), "secret-value");
  await userEvent.click(screen.getByTestId("paypal-save"));

  // when
  await userEvent.type(await screen.findByTestId("admin-reauthentication-password"), "current-password");
  await userEvent.click(screen.getByTestId("admin-reauthentication-submit"));

  // then
  expect(await screen.findByTestId("paypal-form-success")).toBeInTheDocument();
  expect(proved).toHaveBeenCalledWith("current-password");
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1], "the retry repeats the refused save").toEqual(save.mock.calls[0]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("given stored credentials, when the removal is confirmed, then they are removed and the page shows nothing stored", async () => {
  // given
  const read = vi.spyOn(api, "payPalSettings").mockResolvedValueOnce(stored).mockRejectedValue(new Error("not read again"));
  const remove = vi.spyOn(api, "removePayPalCredentials").mockResolvedValue(undefined);
  show();
  await userEvent.click(await screen.findByTestId("paypal-remove"));
  expect(remove, "the first click only asks").not.toHaveBeenCalled();
  expect(screen.getByTestId("paypal-remove-warning")).toBeInTheDocument();

  // when
  await userEvent.click(screen.getByTestId("paypal-remove-confirm"));

  // then
  expect(await screen.findByTestId("paypal-form-success")).toHaveTextContent(i18n.t("admin.paypal.removed"));
  expect(remove).toHaveBeenCalledOnce();
  expect(read, "the removal answers for itself, so no second read can fail").toHaveBeenCalledOnce();
  expect(screen.getByTestId("paypal-secret-state")).toHaveAttribute("data-stored", "false");
  expect(screen.getByTestId("paypal-client-id")).toHaveValue("");
  expect(screen.queryByTestId("paypal-remove")).not.toBeInTheDocument();
});

it("given a removal that is started, when the board keeps the credentials, then nothing is removed", async () => {
  // given
  const remove = vi.spyOn(api, "removePayPalCredentials");
  await opened(stored);
  await userEvent.click(screen.getByTestId("paypal-remove"));

  // when
  await userEvent.click(screen.getByTestId("paypal-remove-cancel"));

  // then
  expect(remove).not.toHaveBeenCalled();
  expect(screen.getByTestId("paypal-remove")).toBeInTheDocument();
});

it("given a removal that needs a fresh proof, when the treasurer confirms the password, then the removal is sent again", async () => {
  // given
  vi.spyOn(api, "payPalSettings").mockResolvedValueOnce(stored).mockResolvedValueOnce(nothingStored);
  vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
  const save = vi.spyOn(api, "savePayPalSettings");
  const remove = vi.spyOn(api, "removePayPalCredentials").mockRejectedValueOnce(recentAuthenticationRequired()).mockResolvedValueOnce(undefined);
  show();
  await userEvent.click(await screen.findByTestId("paypal-remove"));
  await userEvent.click(screen.getByTestId("paypal-remove-confirm"));

  // when
  await userEvent.type(await screen.findByTestId("admin-reauthentication-password"), "current-password");
  await userEvent.click(screen.getByTestId("admin-reauthentication-submit"));

  // then
  expect(await screen.findByTestId("paypal-form-success")).toHaveTextContent(i18n.t("admin.paypal.removed"));
  expect(remove).toHaveBeenCalledTimes(2);
  expect(save, "a refused removal is not retried as a save").not.toHaveBeenCalled();
});

it.each<[PayPalConnectionCheckResult["outcome"]]>([["OK"], ["UNREACHABLE"], ["NOT_CONFIGURED"]])(
  "given the check answers %s, when the connection is checked, then that outcome is shown", async (outcome) => {
    // given
    vi.spyOn(api, "checkPayPalConnection").mockResolvedValue({ outcome });
    await opened(stored);

    // when
    await userEvent.click(screen.getByTestId("paypal-check"));

    // then
    const result = await screen.findByTestId("paypal-check-result");
    expect(result).toHaveAttribute("data-outcome", outcome);
    expect(result).toHaveTextContent(i18n.t(`admin.paypal.checkOutcome.${outcome}`));
    expect(screen.queryByTestId("paypal-check-reason")).not.toBeInTheDocument();
  });

it("given PayPal rejects the stored credentials, when the connection is checked, then its reason is shown", async () => {
  // given
  vi.spyOn(api, "checkPayPalConnection").mockResolvedValue({ outcome: "REJECTED", providerReason: "invalid_client" });
  await opened(stored);

  // when
  await userEvent.click(screen.getByTestId("paypal-check"));

  // then
  const result = await screen.findByTestId("paypal-check-result");
  expect(result).toHaveAttribute("data-outcome", "REJECTED");
  expect(result).toHaveTextContent(i18n.t("admin.paypal.checkOutcome.REJECTED"));
  expect(screen.getByTestId("paypal-check-reason")).toHaveTextContent("invalid_client");
});

it("given a check that fails, when the connection is checked, then the failure is reported instead of an outcome", async () => {
  // given
  vi.spyOn(api, "checkPayPalConnection").mockRejectedValue(new ApiError(403, {
    type: "urn:courtside:error:forbidden", title: "Forbidden", status: 403
  }));
  await opened(stored);

  // when
  await userEvent.click(screen.getByTestId("paypal-check"));

  // then
  await waitFor(() => expect(screen.getByTestId("paypal-check-error")).toBeInTheDocument());
  expect(screen.queryByTestId("paypal-check-result")).not.toBeInTheDocument();
});

it("given the settings cannot be read, when the page opens, then the failure offers a retry that reads them again", async () => {
  // given
  const read = vi.spyOn(api, "payPalSettings").mockRejectedValueOnce(new ApiError(500, { type: "about:blank", title: "Server error", status: 500 }))
    .mockResolvedValueOnce(stored);
  show();

  // when
  await userEvent.click(await screen.findByTestId("retry-load"));

  // then
  expect(await screen.findByTestId("paypal-form")).toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(2);
});
