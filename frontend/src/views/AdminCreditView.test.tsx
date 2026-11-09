import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type CreditEntry, type CreditHolder, type CreditLedgerPage, type PayPalRefundOption } from "../api/client";
import i18n from "../i18n";
import { WithClubConfiguration } from "../test/ClubConfiguration";
import { proofOwnerHarness } from "../test/ProofOwner";
import { UnsavedChangesProvider } from "../unsaved/UnsavedChangesProvider";
import { AdminCreditView } from "./AdminCreditView";

const accountId = "77777777-0000-0000-0000-000000000001";
const holder: CreditHolder = { accountId, firstName: "Jane", lastName: "Doe", email: "jane.doe@example.org", balanceMinor: 1500, currency: "EUR" };
const found: CreditHolder = { accountId: "77777777-0000-0000-0000-000000000002", firstName: "John", lastName: "Roe",
  email: "john.roe@example.org", balanceMinor: 0, currency: "EUR" };
const credited: CreditEntry = { id: "88888888-0000-0000-0000-000000000001", kind: "CREDIT", amountMinor: 1500, currency: "EUR",
  balanceAfterMinor: 1500, recordedAt: "2026-11-01T09:00:00Z", note: "Cash at the desk" };
const ledger: CreditLedgerPage = { balanceMinor: 1500, currency: "EUR", items: [credited], nextCursor: null };
const recorded: CreditEntry = { ...credited, id: "88888888-0000-0000-0000-000000000002", amountMinor: 1250, balanceAfterMinor: 2750,
  note: "Season refund" };
const recentAuthenticationRequired = () => new ApiError(403,
  { type: "urn:courtside:error:recent-authentication-required", title: "Recent authentication required", status: 403 });

const orderId = "ORDER-1";
const payment: CreditEntry = { ...credited, id: "88888888-0000-0000-0000-000000000010", kind: "PAYPAL_PAYMENT", amountMinor: 2000,
  balanceAfterMinor: 2000, note: null, paypalOrderId: orderId };
const refundRow: CreditEntry = { ...payment, id: "88888888-0000-0000-0000-000000000011", kind: "PAYPAL_REFUND", amountMinor: -2000,
  balanceAfterMinor: 0 };
const paypalLedger = (...items: CreditEntry[]): CreditLedgerPage => ({ ...ledger, items });

function refundOptions(option: Partial<PayPalRefundOption>) {
  vi.spyOn(api, "payPalRefundOptions").mockResolvedValue({ items: [{ orderId, refundable: false, ...option }] });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(api, "payPalRefundOptions").mockResolvedValue({ items: [] });
  await i18n.changeLanguage("en");
});

function show(wrapper?: ({ children }: { children: ReactNode }) => ReactNode) {
  const Owner = wrapper ?? (({ children }: { children: ReactNode }) => children);
  return render(<MemoryRouter><WithClubConfiguration><UnsavedChangesProvider><Owner>
    <AdminCreditView />
  </Owner></UnsavedChangesProvider></WithClubConfiguration></MemoryRouter>);
}

async function openJane() {
  const row = await screen.findByTestId("credit-holder");
  await userEvent.click(within(row).getByTestId("credit-holder-open"));
  return screen.findByTestId("credit-account");
}

async function enter(kind: "CREDIT" | "PAYOUT", amount: string, note: string) {
  await userEvent.selectOptions(screen.getByTestId("credit-form-kind"), kind);
  await userEvent.type(screen.getByTestId("credit-form-amount"), amount);
  await userEvent.type(screen.getByTestId("credit-form-note"), note);
  await userEvent.click(screen.getByTestId("credit-form-submit"));
}

it("given accounts holding credit, when the page opens, then each is listed with its balance", async () => {
  // given
  const listed = vi.spyOn(api, "creditHolders").mockResolvedValue([holder]);

  // when
  show();

  // then
  const row = await screen.findByTestId("credit-holder");
  expect(listed, "without a search the server lists every balance").toHaveBeenCalledWith(undefined);
  expect(row).toHaveTextContent("Doe, Jane");
  expect(row).toHaveTextContent("jane.doe@example.org");
  expect(within(row).getByTestId("credit-holder-balance")).toHaveTextContent("€15.00");
});

it("given a search text, when the treasurer types it, then the accounts it finds replace the balance list", async () => {
  // given
  const listed = vi.spyOn(api, "creditHolders").mockImplementation((query) => Promise.resolve(query ? [found] : [holder]));
  show();
  await screen.findByTestId("credit-holder");

  // when
  await userEvent.type(screen.getByTestId("credit-search"), "roe");

  // then
  await waitFor(() => expect(screen.getByTestId("credit-holder")).toHaveTextContent("Roe, John"));
  expect(listed).toHaveBeenLastCalledWith("roe");
  expect(screen.getAllByTestId("credit-holder")).toHaveLength(1);
});

it("given an opened account, when a credit is recorded, then the amount goes out in minor units and ledger and list are read again", async () => {
  // given
  const listed = vi.spyOn(api, "creditHolders").mockResolvedValue([holder]);
  const read = vi.spyOn(api, "creditEntries").mockResolvedValueOnce(ledger)
    .mockResolvedValueOnce({ ...ledger, balanceMinor: 2750, items: [recorded, credited] });
  const record = vi.spyOn(api, "recordCreditEntry").mockResolvedValue(recorded);
  show();
  const account = await openJane();
  expect(await within(account).findByTestId("credit-balance")).toHaveTextContent("€15.00");

  // when
  await enter("CREDIT", "12,50", "Season refund");

  // then
  await waitFor(() => expect(within(account).getByTestId("credit-balance")).toHaveTextContent("€27.50"));
  expect(record).toHaveBeenCalledWith(accountId, { kind: "CREDIT", amountMinor: 1250, note: "Season refund" });
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith(accountId, {});
  expect(listed, "the balance list follows the new entry").toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("credit-form-success")).toBeInTheDocument();
  expect(screen.getByTestId("credit-form-amount"), "a recorded entry leaves an empty form").toHaveValue("");
});

it("given an account whose bookings were paid from credit, when the treasurer opens it, then the form offers only the entries a treasurer records", async () => {
  // given
  vi.spyOn(api, "creditHolders").mockResolvedValue([holder]);
  vi.spyOn(api, "creditEntries").mockResolvedValue({ ...ledger, items: [
    { ...credited, id: "88888888-0000-0000-0000-000000000003", kind: "BOOKING_DEBIT", amountMinor: -1500, balanceAfterMinor: 0, note: null, bookingId: "99999999-0000-0000-0000-000000000001" }
  ] });

  // when
  show();
  const account = await openJane();

  // then
  expect(await within(account).findByTestId("credit-entry-kind")).toHaveTextContent("Booking paid");
  const offered = within(screen.getByTestId("credit-form-kind")).getAllByRole("option").map((option) => option.getAttribute("value"));
  expect(offered, "booking payments and refunds are written by the booking itself").toEqual(["CREDIT", "PAYOUT"]);
});

it("given a payout above the balance, when it is recorded, then the refusal names the balance", async () => {
  // given
  vi.spyOn(api, "creditHolders").mockResolvedValue([holder]);
  vi.spyOn(api, "creditEntries").mockResolvedValue(ledger);
  vi.spyOn(api, "recordCreditEntry").mockRejectedValue(new ApiError(409, {
    type: "urn:courtside:error:credit-insufficient", title: "Credit insufficient", status: 409,
    violations: [{ code: "credit.insufficient", params: { balanceMinor: 1500, currency: "EUR" } }]
  }));
  show();
  await openJane();

  // when
  await enter("PAYOUT", "20", "Paid out in cash");

  // then
  const refusal = await screen.findByTestId("credit-form-error");
  expect(refusal).toHaveTextContent(i18n.t("credit.insufficient", { balance: "€15.00" }));
  expect(screen.getByTestId("credit-form-amount"), "a refused entry keeps what was typed").toHaveValue("20");
});

it("given an amount that is no money, when it is recorded, then nothing is sent and the field is refused", async () => {
  // given
  vi.spyOn(api, "creditHolders").mockResolvedValue([holder]);
  vi.spyOn(api, "creditEntries").mockResolvedValue(ledger);
  const record = vi.spyOn(api, "recordCreditEntry");
  show();
  await openJane();

  // when
  await enter("CREDIT", "0", "Nothing");

  // then
  expect(await screen.findByTestId("credit-form-error")).toHaveTextContent(i18n.t("admin.credit.amountInvalid"));
  expect(record).not.toHaveBeenCalled();
});

it("given an entry that needs a fresh proof, when the treasurer confirms the password, then the same entry is sent again", async () => {
  // given
  const owner = proofOwnerHarness();
  vi.spyOn(api, "creditHolders").mockResolvedValue([holder]);
  vi.spyOn(api, "creditEntries").mockResolvedValue(ledger);
  const proved = vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
  const record = vi.spyOn(api, "recordCreditEntry").mockRejectedValueOnce(recentAuthenticationRequired()).mockResolvedValueOnce(recorded);
  show(owner.Wrapper);
  await openJane();
  await enter("CREDIT", "12.50", "Season refund");

  // when
  await userEvent.type(await screen.findByTestId("admin-reauthentication-password"), "current-password");
  await userEvent.click(screen.getByTestId("admin-reauthentication-submit"));

  // then
  expect(await screen.findByTestId("credit-form-success")).toBeInTheDocument();
  expect(proved).toHaveBeenCalledWith("current-password");
  expect(record).toHaveBeenCalledTimes(2);
  expect(record.mock.calls[1], "the retry repeats the refused entry").toEqual(record.mock.calls[0]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("given a fresh proof is requested, when the dialog is dismissed, then the entry is not sent again and stays in the form", async () => {
  // given
  vi.spyOn(api, "creditHolders").mockResolvedValue([holder]);
  vi.spyOn(api, "creditEntries").mockResolvedValue(ledger);
  const record = vi.spyOn(api, "recordCreditEntry").mockRejectedValue(recentAuthenticationRequired());
  show();
  await openJane();
  await enter("CREDIT", "12.50", "Season refund");
  await screen.findByTestId("admin-reauthentication-password");

  // when
  await userEvent.keyboard("{Escape}");

  // then
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(record).toHaveBeenCalledOnce();
  expect(screen.getByTestId("credit-form-note")).toHaveValue("Season refund");
});

it("given a refundable PayPal payment, when the treasurer confirms, then the order is posted and ledger and options are read again", async () => {
  // given
  vi.spyOn(api, "creditHolders").mockResolvedValue([holder]);
  const read = vi.spyOn(api, "creditEntries").mockResolvedValueOnce(paypalLedger(payment))
    .mockResolvedValueOnce(paypalLedger(refundRow, payment));
  const options = vi.spyOn(api, "payPalRefundOptions").mockResolvedValueOnce({ items: [{ orderId, refundable: true }] })
    .mockResolvedValueOnce({ items: [{ orderId, refundable: false, status: "COMPLETED", blockedBy: "payment.paypal.refund.alreadyRefunded" }] });
  const refund = vi.spyOn(api, "refundPayPalPayment").mockResolvedValue({ orderId, status: "COMPLETED" });
  show();
  const account = await openJane();

  // when
  await userEvent.click(await within(account).findByTestId("paypal-refund"));
  const dialog = await screen.findByRole("dialog");
  expect(dialog, "the dialog names the amount and the credit taken back").toHaveTextContent("€20.00");
  expect(refund).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByTestId("paypal-refund-confirm"));

  // then
  await waitFor(() => expect(within(account).queryByTestId("paypal-refund")).not.toBeInTheDocument());
  expect(refund).toHaveBeenCalledExactlyOnceWith(orderId);
  expect(read).toHaveBeenCalledTimes(2);
  expect(options).toHaveBeenCalledTimes(2);
  expect(options).toHaveBeenLastCalledWith(accountId);
  expect(within(account).getAllByTestId("paypal-refund-state").map((state) => state.getAttribute("data-status"))).toContain("COMPLETED");
});

it("given a refundable PayPal payment, when the dialog is cancelled, then nothing is posted", async () => {
  // given
  vi.spyOn(api, "creditHolders").mockResolvedValue([holder]);
  vi.spyOn(api, "creditEntries").mockResolvedValue(paypalLedger(payment));
  refundOptions({ refundable: true });
  const refund = vi.spyOn(api, "refundPayPalPayment");
  show();
  const account = await openJane();
  await userEvent.click(await within(account).findByTestId("paypal-refund"));

  // when
  await userEvent.click(within(await screen.findByRole("dialog")).getByTestId("paypal-refund-cancel"));

  // then
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(refund).not.toHaveBeenCalled();
});

it("given a payment whose credit was spent, when the ledger shows it, then the reason replaces the action", async () => {
  // given
  vi.spyOn(api, "creditHolders").mockResolvedValue([holder]);
  vi.spyOn(api, "creditEntries").mockResolvedValue(paypalLedger(payment));
  refundOptions({ blockedBy: "payment.paypal.refund.creditSpent" });

  // when
  show();
  const account = await openJane();

  // then
  expect(await within(account).findByTestId("paypal-refund-blocked")).toHaveTextContent(i18n.t("payment.paypal.refund.creditSpent"));
  expect(within(account).queryByTestId("paypal-refund")).not.toBeInTheDocument();
});

it.each([
  ["PENDING", undefined, "unclear, check the PayPal account"],
  ["COMPLETED", undefined, "Returned through PayPal"],
  ["FAILED", "INSTRUMENT_DECLINED", "INSTRUMENT_DECLINED"]
] as const)("given a refund in state %s, when the ledger shows it, then the row says so", async (status, failureReason, text) => {
  // given
  vi.spyOn(api, "creditHolders").mockResolvedValue([holder]);
  vi.spyOn(api, "creditEntries").mockResolvedValue(paypalLedger(refundRow));
  refundOptions({ status, failureReason });

  // when
  show();
  const account = await openJane();

  // then
  const state = await within(account).findByTestId("paypal-refund-state");
  expect(state).toHaveAttribute("data-status", status);
  expect(state).toHaveTextContent(text);
});

it("given a refund that needs a fresh proof, when the treasurer confirms the password, then the same order is posted again", async () => {
  // given
  const owner = proofOwnerHarness();
  vi.spyOn(api, "creditHolders").mockResolvedValue([holder]);
  vi.spyOn(api, "creditEntries").mockResolvedValue(paypalLedger(payment));
  refundOptions({ refundable: true });
  const proved = vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
  const refund = vi.spyOn(api, "refundPayPalPayment").mockRejectedValueOnce(recentAuthenticationRequired())
    .mockResolvedValueOnce({ orderId, status: "COMPLETED" });
  show(owner.Wrapper);
  const account = await openJane();
  await userEvent.click(await within(account).findByTestId("paypal-refund"));
  await userEvent.click(within(await screen.findByRole("dialog")).getByTestId("paypal-refund-confirm"));

  // when
  await userEvent.type(await screen.findByTestId("admin-reauthentication-password"), "current-password");
  await userEvent.click(screen.getByTestId("admin-reauthentication-submit"));

  // then
  await waitFor(() => expect(refund).toHaveBeenCalledTimes(2));
  expect(proved).toHaveBeenCalledWith("current-password");
  expect(refund.mock.calls[1]).toEqual([orderId]);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("given PayPal refuses the refund, when the treasurer confirms, then the violation is shown translated", async () => {
  // given
  vi.spyOn(api, "creditHolders").mockResolvedValue([holder]);
  vi.spyOn(api, "creditEntries").mockResolvedValue(paypalLedger(payment));
  refundOptions({ refundable: true });
  vi.spyOn(api, "refundPayPalPayment").mockRejectedValue(new ApiError(409, {
    type: "urn:courtside:error:paypal-refund-refused", title: "Refused", status: 409,
    violations: [{ code: "payment.paypal.refund.creditSpent", params: { amountMinor: 2000, balanceMinor: 0, currency: "EUR" } }]
  }));
  show();
  const account = await openJane();
  await userEvent.click(await within(account).findByTestId("paypal-refund"));

  // when
  await userEvent.click(within(await screen.findByRole("dialog")).getByTestId("paypal-refund-confirm"));

  // then
  expect(await screen.findByTestId("paypal-refund-error")).toHaveTextContent(i18n.t("payment.paypal.refund.creditSpent"));
});
