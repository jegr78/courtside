import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { PAYPAL_STUB_SCRIPT } from "./paypal-stub";

const BROWSER_ORIGIN = "http://paypal-sandbox.test:8080";
const RETURN_URL = "https://courtside.test/payment/paypal/return";
const CANCEL_URL = "https://courtside.test/payment/paypal/cancel";

interface StubAnswer {
  id: string;
  status: string;
  access_token?: string;
  expires_in?: unknown;
  links: { rel: string; href: string }[];
  purchase_units: { custom_id: string; amount: unknown; payments?: { captures: { id: string }[]; refunds?: unknown[] } }[];
  details: { issue: string }[];
}

let stub: ChildProcess | undefined;

afterEach(() => {
  stub?.kill();
  stub = undefined;
});

async function startStub(): Promise<string> {
  stub = spawn(process.execPath, ["-e", PAYPAL_STUB_SCRIPT, BROWSER_ORIGIN, "0"], { stdio: ["ignore", "pipe", "inherit"] });
  const [ready] = await once(stub.stdout!, "data") as [Buffer];
  const port = /ready on (\d+)/.exec(ready.toString())?.[1];
  if (!port) throw new Error(`The stub did not name its port: ${ready.toString()}`);
  return `http://127.0.0.1:${port}`;
}

async function call(base: string, method: string, path: string, body?: unknown) {
  const response = await fetch(base + path, { method, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await response.text();
  return { status: response.status, location: response.headers.get("location"), text,
    json: () => JSON.parse(text) as StubAnswer };
}

async function createOrder(base: string) {
  return (await call(base, "POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{ custom_id: "booking-1", amount: { currency_code: "EUR", value: "18.00" } }],
    payment_source: { paypal: { experience_context: { return_url: RETURN_URL, cancel_url: CANCEL_URL } } }
  })).json();
}

describe("the PayPal stub the journeys pay at", () => {
  it("given a created order, when the payer approves it at the stub, then the browser returns with the order id and one capture completes it", async () => {
    // given
    const base = await startStub();
    const token = (await call(base, "POST", "/v1/oauth2/token")).json();
    const order = await createOrder(base);
    const approve = order.links.find((link) => link.rel === "payer-action")!.href;

    // when
    const refusedEarly = await call(base, "POST", `/v2/checkout/orders/${order.id}/capture`, {});
    const approved = await call(base, "GET", `/approve/confirm?token=${order.id}`);
    const read = (await call(base, "GET", `/v2/checkout/orders/${order.id}`)).json();
    const captured = await call(base, "POST", `/v2/checkout/orders/${order.id}/capture`, {});
    const again = await call(base, "POST", `/v2/checkout/orders/${order.id}/capture`, {});

    // then
    expect(token.access_token, "the token request answers a token with a lifetime").toBeTruthy();
    expect(typeof token.expires_in).toBe("number");
    expect(approve, "the approve link names the address the browser reaches").toBe(`${BROWSER_ORIGIN}/approve?token=${order.id}`);
    expect(refusedEarly.status, "an order nobody approved is not captured").toBe(422);
    expect(approved.status).toBe(303);
    expect(approved.location).toBe(`${RETURN_URL}?token=${order.id}`);
    expect(read.status).toBe("APPROVED");
    expect(read.purchase_units[0]).toMatchObject({ custom_id: "booking-1", amount: { currency_code: "EUR", value: "18.00" } });
    expect(captured.status).toBe(201);
    expect(captured.json().purchase_units[0].payments?.captures[0]).toMatchObject({ status: "COMPLETED", amount: { value: "18.00" } });
    expect(again.json().details[0].issue, "a second capture is answered as PayPal answers it").toBe("ORDER_ALREADY_CAPTURED");
  });

  it("given a created order, when the payer turns back at the stub, then the page leads to the cancel address and the order stays unapproved", async () => {
    // given
    const base = await startStub();
    const order = await createOrder(base);

    // when
    const page = await call(base, "GET", `/approve?token=${order.id}`);
    const read = (await call(base, "GET", `/v2/checkout/orders/${order.id}`)).json();

    // then
    expect(page.text).toContain(`href="${CANCEL_URL}?token=${order.id}"`);
    expect(page.text).toContain('data-testid="paypal-stub-approve"');
    expect(read.status, "an order the payer left is one Courtside may void").toBe("PAYER_ACTION_REQUIRED");
  });

  it("given a captured order, when Courtside refunds its capture, then the refund completes, the order lists it and a second refund is refused as PayPal refuses it", async () => {
    // given
    const base = await startStub();
    const order = await createOrder(base);
    await call(base, "GET", `/approve/confirm?token=${order.id}`);
    const captureId = (await call(base, "POST", `/v2/checkout/orders/${order.id}/capture`, {})).json()
      .purchase_units[0].payments!.captures[0].id;

    // when
    const refunded = await call(base, "POST", `/v2/payments/captures/${captureId}/refund`, {});
    const again = await call(base, "POST", `/v2/payments/captures/${captureId}/refund`, {});
    const read = (await call(base, "GET", `/v2/checkout/orders/${order.id}`)).json();
    const lookup = await call(base, "GET", `/v2/payments/refunds/${refunded.json().id}`);

    // then
    expect(refunded.status).toBe(201);
    expect(refunded.json()).toMatchObject({ status: "COMPLETED", amount: { currency_code: "EUR", value: "18.00" } });
    expect(again.json().details[0].issue, "a refunded capture is not refunded twice").toBe("CAPTURE_FULLY_REFUNDED");
    expect(read.purchase_units[0].payments?.refunds, "the order lists the refund").toEqual([refunded.json()]);
    expect(lookup.json(), "the refund can be read by its id").toEqual(refunded.json());
  });
});
