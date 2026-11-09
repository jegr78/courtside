import { GenericContainer, Wait, type StartedNetwork, type StartedTestContainer } from "testcontainers";
import { PINNED_BROWSER_IMAGE } from "./container-images";

export const PAYPAL_STUB_HOST = "paypal-sandbox.test";
const PAYPAL_STUB_PORT = 8080;

// The PayPal endpoints Courtside calls, and the approve page a payer sees, answered from memory.
export const PAYPAL_STUB_SCRIPT = `const http = require("node:http");
const { randomUUID } = require("node:crypto");
const browserOrigin = process.argv[1];
const orders = new Map();
const refunds = new Map();
const json = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};
const representation = (order) => ({
  id: order.id,
  status: order.status,
  purchase_units: [{
    custom_id: order.customId,
    amount: order.amount,
    ...order.capture ? { payments: { captures: [order.capture], ...order.refund ? { refunds: [order.refund] } : {} } } : {}
  }],
  links: [{ rel: "payer-action", href: browserOrigin + "/approve?token=" + order.id, method: "GET" }]
});
const escape = (text) => text.replace(/[^A-Za-z0-9:/?=._-]/g, (character) => "&#" + character.charCodeAt(0) + ";");
const read = (request) => new Promise((resolve) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => resolve(body));
});
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://stub");
  const body = await read(request);
  const capture = url.pathname.match(/^\\/v2\\/checkout\\/orders\\/([A-Za-z0-9-]+)\\/capture$/);
  const lookup = url.pathname.match(/^\\/v2\\/checkout\\/orders\\/([A-Za-z0-9-]+)$/);
  const refund = url.pathname.match(/^\\/v2\\/payments\\/captures\\/([A-Za-z0-9-]+)\\/refund$/);
  const refundLookup = url.pathname.match(/^\\/v2\\/payments\\/refunds\\/([A-Za-z0-9-]+)$/);
  const captured = refund && [...orders.values()].find((candidate) => candidate.capture?.id === refund[1]);
  if (request.method === "POST" && url.pathname === "/v1/oauth2/token") {
    return json(response, 200, { access_token: randomUUID(), token_type: "Bearer", expires_in: 32400 });
  }
  if (request.method === "POST" && url.pathname === "/v2/checkout/orders") {
    const created = JSON.parse(body);
    const unit = created.purchase_units[0];
    const context = created.payment_source.paypal.experience_context;
    const order = { id: "STUB" + randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase(), status: "PAYER_ACTION_REQUIRED",
      customId: unit.custom_id, amount: unit.amount, returnUrl: context.return_url, cancelUrl: context.cancel_url };
    orders.set(order.id, order);
    return json(response, 200, representation(order));
  }
  if (request.method === "GET" && lookup && orders.has(lookup[1])) {
    return json(response, 200, representation(orders.get(lookup[1])));
  }
  if (request.method === "POST" && capture && orders.has(capture[1])) {
    const order = orders.get(capture[1]);
    if (order.status === "COMPLETED") {
      return json(response, 422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] });
    }
    if (order.status !== "APPROVED") {
      return json(response, 422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }] });
    }
    order.status = "COMPLETED";
    order.capture = { id: "CAPTURE" + order.id.slice(4), status: "COMPLETED", amount: order.amount };
    return json(response, 201, representation(order));
  }
  if (request.method === "POST" && captured) {
    if (captured.refund) {
      return json(response, 422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "CAPTURE_FULLY_REFUNDED" }] });
    }
    captured.refund = { id: "REFUND" + captured.id.slice(4), status: "COMPLETED", amount: captured.capture.amount };
    captured.capture.status = "REFUNDED";
    refunds.set(captured.refund.id, captured.refund);
    return json(response, 201, captured.refund);
  }
  if (request.method === "GET" && refundLookup && refunds.has(refundLookup[1])) {
    return json(response, 200, refunds.get(refundLookup[1]));
  }
  const order = orders.get(url.searchParams.get("token") ?? "");
  if (request.method === "GET" && url.pathname === "/approve" && order) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return response.end("<!doctype html><html lang=\\"en\\"><title>PayPal sandbox</title><main data-testid=\\"paypal-stub\\">"
      + "<h1>PayPal sandbox</h1><p>" + escape(order.amount.value + " " + order.amount.currency_code) + "</p>"
      + "<a data-testid=\\"paypal-stub-approve\\" href=\\"/approve/confirm?token=" + order.id + "\\">Pay</a> "
      + "<a data-testid=\\"paypal-stub-cancel\\" href=\\"" + escape(order.cancelUrl + "?token=" + order.id) + "\\">Cancel</a>"
      + "</main></html>");
  }
  if (request.method === "GET" && url.pathname === "/approve/confirm" && order) {
    if (order.status === "PAYER_ACTION_REQUIRED") order.status = "APPROVED";
    response.writeHead(303, { location: order.returnUrl + "?token=" + order.id });
    return response.end();
  }
  json(response, 404, { name: "RESOURCE_NOT_FOUND", message: "The stub knows no such resource" });
});
server.listen(Number(process.argv[2]), "0.0.0.0", () => console.log("paypal stub ready on " + server.address().port));
`;

export interface StartedPayPalStub {
  container: StartedTestContainer;
  endpoint: string;
}

// The pinned browser image carries Node, and it is the only image this harness already vouches for.
export async function startPayPalStub(network: StartedNetwork): Promise<StartedPayPalStub> {
  const container = await new GenericContainer(PINNED_BROWSER_IMAGE)
    .withNetwork(network)
    .withNetworkAliases(PAYPAL_STUB_HOST)
    .withCommand(["node", "-e", PAYPAL_STUB_SCRIPT, `http://${PAYPAL_STUB_HOST}:${PAYPAL_STUB_PORT}`, String(PAYPAL_STUB_PORT)])
    .withExposedPorts(PAYPAL_STUB_PORT)
    .withWaitStrategy(Wait.forLogMessage(/paypal stub ready/))
    .start();
  return { container, endpoint: `http://${container.getHost()}:${container.getMappedPort(PAYPAL_STUB_PORT)}` };
}
