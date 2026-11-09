import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import { ApiError, api, type PayPalCaptureOutcome, type SessionStatus } from "../api/client";
import i18n from "../i18n";
import { WithClubConfiguration } from "../test/ClubConfiguration";
import { PayPalPaymentView } from "./PayPalPaymentView";

const bookingId = "33333333-3333-3333-3333-333333333333";
const anonymous: SessionStatus = { authenticated: false, roles: [], passwordChangeRequired: false };
const external: SessionStatus = { authenticated: true, username: "roe.john", roles: ["EXTERNAL"], passwordChangeRequired: false,
  memberFeatures: false };

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("de");
});

function Address() {
  const location = useLocation();
  return <output data-testid="payment-address">{location.pathname + location.search + location.hash}</output>;
}

function show(mode: "return" | "cancel", path: string) {
  render(<MemoryRouter initialEntries={[path]}><PayPalPaymentView mode={mode} /><Address /></MemoryRouter>);
}

function routes(session: SessionStatus, path: string) {
  const router = createMemoryRouter([{ path: "*", element: <WithClubConfiguration>
    <AppRoutes session={session} refreshSession={() => Promise.resolve()} /><Address />
  </WithClubConfiguration> }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}

it("given a return from PayPal, when the capture is still running, then the page says the payment is being processed", async () => {
  // given
  vi.spyOn(api, "capturePayPalOrder").mockImplementation(() => new Promise(() => {}));

  // when
  show("return", "/payment/paypal/return?token=ORDER-1");

  // then
  expect(await screen.findByTestId("paypal-processing")).toHaveTextContent("Zahlung wird verarbeitet");
  expect(api.capturePayPalOrder).toHaveBeenCalledWith("ORDER-1");
});

it("given a return from PayPal, when the capture confirms the booking, then the page says so and links to that booking", async () => {
  // given
  vi.spyOn(api, "capturePayPalOrder").mockResolvedValue({ bookingId, outcome: "CONFIRMED" });

  // when
  show("return", "/payment/paypal/return?token=ORDER-1");

  // then
  const outcome = await screen.findByTestId("paypal-outcome");
  expect(outcome).toHaveAttribute("data-outcome", "CONFIRMED");
  expect(outcome).toHaveTextContent(i18n.t("paypalPayment.return.CONFIRMED"));
  const link = screen.getByTestId("paypal-to-bookings");
  expect(link).toHaveAttribute("href", `/my-bookings#booking-${bookingId}`);
  expect(link).toHaveTextContent(i18n.t("paypalPayment.toBooking"));
  expect(screen.queryByTestId("paypal-processing"), "a settled payment is no longer being processed").toBeNull();
  expect(api.capturePayPalOrder, "one return captures once").toHaveBeenCalledTimes(1);
});

it.each<[PayPalCaptureOutcome, string]>([
  ["LATE_CREDITED", "paypalPayment.return.LATE_CREDITED"],
  ["REJECTED", "paypalPayment.return.REJECTED"],
  ["PROCESSING", "paypalPayment.return.PROCESSING"]
])("given a return from PayPal, when the capture answers %s, then the page tells what became of the payment and the court", async (answer, key) => {
  // given
  vi.spyOn(api, "capturePayPalOrder").mockResolvedValue({ bookingId, outcome: answer });

  // when
  show("return", "/payment/paypal/return?token=ORDER-1");

  // then
  const outcome = await screen.findByTestId("paypal-outcome");
  expect(outcome).toHaveAttribute("data-outcome", answer);
  expect(outcome).toHaveTextContent(i18n.t(key));
  expect(screen.getByTestId("paypal-to-bookings")).toHaveAttribute("href", "/my-bookings");
});

it("given a late capture, when the page explains it, then it never promises the amount is on the credit for certain", async () => {
  // given
  vi.spyOn(api, "capturePayPalOrder").mockResolvedValue({ bookingId, outcome: "LATE_CREDITED" });

  // when
  show("return", "/payment/paypal/return?token=ORDER-1");

  // then
  expect(await screen.findByTestId("paypal-outcome"), "an anonymised account is not credited, the club follows up instead")
    .toHaveTextContent(/Verein/);
});

it.each<[PayPalCaptureOutcome, string]>([
  ["REJECTED", "paypalPayment.cancel.REJECTED"],
  ["CONFIRMED", "paypalPayment.cancel.CONFIRMED"],
  ["LATE_CREDITED", "paypalPayment.cancel.LATE_CREDITED"],
  ["PROCESSING", "paypalPayment.cancel.PROCESSING"]
])("given a cancel at PayPal, when the cancel answers %s, then the page tells what happened to the booking", async (answer, key) => {
  // given
  vi.spyOn(api, "cancelPayPalOrder").mockResolvedValue({ bookingId, outcome: answer });
  const capture = vi.spyOn(api, "capturePayPalOrder");

  // when
  show("cancel", "/payment/paypal/cancel?token=ORDER-1");

  // then
  const outcome = await screen.findByTestId("paypal-outcome");
  expect(outcome).toHaveAttribute("data-outcome", answer);
  expect(outcome).toHaveTextContent(i18n.t(key));
  expect(api.cancelPayPalOrder).toHaveBeenCalledWith("ORDER-1");
  expect(capture, "a cancel never captures").not.toHaveBeenCalled();
});

it("given an address without an order, when the page opens, then it calls nothing and says the payment is unknown", async () => {
  // given
  const capture = vi.spyOn(api, "capturePayPalOrder");

  // when
  show("return", "/payment/paypal/return");

  // then
  expect(await screen.findByTestId("paypal-failure")).toHaveTextContent(i18n.t("paypalPayment.missingOrder"));
  expect(capture).not.toHaveBeenCalled();
});

it("given an order of another account, when the capture is refused, then the page shows the refusal", async () => {
  // given
  vi.spyOn(api, "capturePayPalOrder").mockRejectedValue(new ApiError(404, {
    type: "urn:courtside:error:paypal-order-not-found", title: "Not found", status: 404
  }));

  // when
  show("return", "/payment/paypal/return?token=ORDER-1");

  // then
  expect(await screen.findByTestId("paypal-failure")).toHaveTextContent(i18n.t("error.type.paypal-order-not-found"));
});

it("given a session that ended at PayPal, when the capture answers unauthenticated, then the page leaves sign-in to the shell and shows no failure", async () => {
  // given
  vi.spyOn(api, "capturePayPalOrder").mockRejectedValue(new ApiError(401, {
    type: "urn:courtside:error:unauthenticated", title: "Unauthenticated", status: 401
  }));

  // when
  show("return", "/payment/paypal/return?token=ORDER-1");

  // then
  await waitFor(() => expect(api.capturePayPalOrder).toHaveBeenCalled());
  await new Promise((settled) => setTimeout(settled, 0));
  expect(screen.queryByTestId("paypal-failure"), "the shell sends the player through sign-in and back").toBeNull();
  expect(screen.getByTestId("paypal-processing")).toBeInTheDocument();
});

it.each(["/payment/paypal/return?token=ORDER-1", "/payment/paypal/cancel?token=ORDER-1"])("given a signed-out visitor, when PayPal sends them to %s, then sign-in comes first and keeps the order in the address", async (path) => {
  // given
  const capture = vi.spyOn(api, "capturePayPalOrder");
  const cancel = vi.spyOn(api, "cancelPayPalOrder");

  // when
  routes(anonymous, path);

  // then
  expect(await screen.findByTestId("login-view")).toBeInTheDocument();
  expect(screen.getByTestId("payment-address")).toHaveTextContent(`/login?returnTo=${encodeURIComponent(path)}`);
  expect(capture, "nothing is captured before the booker is known").not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});

it("given a signed-in booker, when PayPal sends them back, then the return page captures the order", async () => {
  // given
  vi.spyOn(api, "capturePayPalOrder").mockResolvedValue({ bookingId, outcome: "CONFIRMED" });

  // when
  routes(external, "/payment/paypal/return?token=ORDER-1");

  // then
  expect(await screen.findByTestId("paypal-outcome")).toHaveAttribute("data-outcome", "CONFIRMED");
});
