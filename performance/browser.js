import { browser } from "k6/browser";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const contract = JSON.parse(open("/scripts/contract.json"));
const credentials = JSON.parse(open("/run/courtside/perf.json"));
const profile = contract.profiles.browser;
const target = __ENV.PERF_TARGET;
const browserErrors = new Counter("browser_errors");
const browserRequests = new Counter("browser_requests");
const browserJourneySuccess = new Rate("browser_journey_success");
const browserJourneyDuration = new Trend("browser_journey_duration", true);
const technicalErrors = new Rate("technical_errors");
const unexpectedServerErrors = new Counter("unexpected_server_errors");

export const options = {
  scenarios: {
    browser: {
      executor: "constant-vus",
      vus: profile.virtualUsers,
      duration: profile.duration,
      options: { browser: { type: "chromium" } }
    }
  },
  thresholds: {
    technical_errors: [contract.thresholds.technicalErrorRate],
    unexpected_server_errors: [contract.thresholds.unexpectedServerErrors],
    browser_errors: ["count==0"],
    browser_journey_success: ["rate==1"],
    browser_web_vital_lcp: [`p(75)<${contract.thresholds.webVitals.lcpMilliseconds}`],
    browser_web_vital_inp: [`p(75)<${contract.thresholds.webVitals.inpMilliseconds}`],
    browser_web_vital_cls: [`p(75)<${contract.thresholds.webVitals.cls}`]
  }
};

function username() {
  return `member${String(__VU).padStart(4, "0")}`;
}

function bookingInput() {
  const start = new Date(Date.now() + (2 + (__ITER % 5)) * 86_400_000);
  start.setUTCHours(10 + __VU, 0, 0, 0);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3_600_000).toISOString(),
    idempotencyKey: `k6-browser-${__ENV.PERF_RUN_ID}-${__VU}-${__ITER}`
  };
}

async function createBooking(page) {
  return page.evaluate(async (serialized) => {
    const input = JSON.parse(serialized);
    const token = decodeURIComponent(document.cookie.split("; ")
      .find((entry) => entry.startsWith("XSRF-TOKEN="))?.substring("XSRF-TOKEN=".length) ?? "");
    const [cardsResponse, courtsResponse] = await Promise.all([
      fetch("/api/public/booking-cards"), fetch("/api/public/courts")
    ]);
    const cards = await cardsResponse.json();
    const courts = await courtsResponse.json();
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-XSRF-TOKEN": token,
        "Idempotency-Key": input.idempotencyKey
      },
      body: JSON.stringify({
        courtIds: [courts[(input.virtualUser - 1) % courts.length].id],
        cardId: cards[0].id,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        participants: [{ guestName: "Browser Test Guest" }]
      })
    });
    return { status: response.status, body: await response.json() };
  }, JSON.stringify({ ...bookingInput(), virtualUser: __VU }));
}

async function authenticatedSession(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/session");
    return { status: response.status, body: await response.json() };
  });
}

async function allocationExists(page, bookingId, startsAt) {
  return page.evaluate(async (serialized) => {
    const input = JSON.parse(serialized);
    const response = await fetch(`/api/bookings?date=${input.startsAt.slice(0, 10)}`);
    const allocations = await response.json();
    return { status: response.status, found: allocations.some((entry) => entry.bookingId === input.bookingId) };
  }, JSON.stringify({ bookingId, startsAt }));
}

async function cancelBooking(page, bookingId) {
  return page.evaluate(async (id) => {
    const token = decodeURIComponent(document.cookie.split("; ")
      .find((entry) => entry.startsWith("XSRF-TOKEN="))?.substring("XSRF-TOKEN=".length) ?? "");
    return (await fetch(`/api/bookings/${id}`, {
      method: "DELETE", headers: { "X-XSRF-TOKEN": token }
    })).status;
  }, bookingId);
}

export default async function () {
  const page = await browser.newPage();
  const started = Date.now();
  let bookingId;
  let journeyPassed = false;
  browserErrors.add(0);
  unexpectedServerErrors.add(0);
  page.on("requestfailed", (request) => {
    const path = request.url().replace(target, "").split("?")[0];
    const expectedEmptyMutation = request.failure()?.errorText === "net::ERR_ABORTED"
      && ((request.method() === "POST" && path === "/api/session")
        || (request.method() === "DELETE" && path.startsWith("/api/bookings/")));
    if (expectedEmptyMutation) return;
    browserErrors.add(1);
    technicalErrors.add(true);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.add(1);
      technicalErrors.add(true);
    }
  });
  page.on("response", (response) => {
    browserRequests.add(1);
    if (response.status() >= 500) {
      unexpectedServerErrors.add(1);
      technicalErrors.add(true);
    }
  });
  try {
    await page.goto(`${target}/login`, { waitUntil: "networkidle" });
    await page.getByTestId("login-view").waitFor();
    await page.getByTestId("username").fill(username());
    await page.getByTestId("password").fill(credentials.password);
    await page.getByTestId("login-submit").click();
    await page.getByTestId("home-view").waitFor();
    await page.getByTestId("week-grid").waitFor();
    await page.getByTestId("week-next").click();
    await page.locator('[data-testid="week-grid"][data-week-offset="1"]').waitFor();
    await page.getByTestId("week-previous").click();
    await page.locator('[data-testid="week-grid"][data-week-offset="0"]').waitFor();
    const input = bookingInput();
    const created = await createBooking(page);
    bookingId = created.body?.id;
    const allocation = bookingId ? await allocationExists(page, bookingId, input.startsAt) : undefined;
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("home-view").waitFor();
    const session = await authenticatedSession(page);
    journeyPassed = check({ created, allocation, session }, {
      "browser booking was created": (value) => value.created.status === 201 && Boolean(value.created.body?.id),
      "browser booking is visible": (value) => value.allocation?.status === 200 && value.allocation.found,
      "browser session survives reload": (value) => value.session.status === 200 && value.session.body.authenticated === true
    });
    technicalErrors.add(!journeyPassed);
  } catch (error) {
    browserErrors.add(1);
    technicalErrors.add(true);
    console.error(`Browser journey failed: ${error}`);
  } finally {
    if (bookingId) {
      try {
        const status = await cancelBooking(page, bookingId);
        if (status !== 204) technicalErrors.add(true);
      } catch {
        browserErrors.add(1);
        technicalErrors.add(true);
      }
    }
    browserJourneySuccess.add(journeyPassed);
    browserJourneyDuration.add(Date.now() - started);
    await page.close();
  }
}

export function handleSummary(data) {
  return { "/results/raw-summary.json": JSON.stringify(data, null, 2) };
}
