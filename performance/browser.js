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

async function cancelBooking(page, bookingId) {
  await page.goto(`${target}/my-bookings`, { waitUntil: "networkidle" });
  const cancellation = page.locator(`[data-testid="personal-cancel"][data-booking-id="${bookingId}"]`);
  await cancellation.waitFor();
  await cancellation.click();
  await page.getByTestId("confirm-cancellation").click();
  await cancellation.waitFor({ state: "detached" });
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
    await page.getByTestId("court-plan-view").waitFor();
    await page.getByTestId("week-grid").waitFor();
    await page.getByTestId("week-next").click();
    await page.locator('[data-testid="week-grid"][data-week-offset="1"]').waitFor();
    await page.getByTestId("free-slot").nth(__VU - 1).click();
    await page.getByTestId("guest-name").fill("Browser Test Guest");
    const bookingResponsePromise = page.waitForResponse(`${target}/api/bookings`);
    await page.getByTestId("booking-submit").click();
    const response = await bookingResponsePromise;
    if (response.status() !== 201) throw new Error(`The booking UI returned status ${response.status()}`);
    bookingId = (await response.json()).id;
    if (!bookingId) throw new Error("The booking UI returned no booking id");
    const ownAllocation = page.locator(`[data-testid="own-allocation"][data-booking-id="${bookingId}"]`);
    await ownAllocation.waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("court-plan-view").waitFor();
    await page.getByTestId("my-bookings-link").click();
    const cancellation = page.locator(`[data-testid="personal-cancel"][data-booking-id="${bookingId}"]`);
    await cancellation.waitFor();
    await cancellation.click();
    await page.getByTestId("confirm-cancellation").click();
    await cancellation.waitFor({ state: "detached" });
    bookingId = undefined;
    journeyPassed = check(true, { "browser booking workflow completes": (completed) => completed });
    technicalErrors.add(!journeyPassed);
  } catch (error) {
    browserErrors.add(1);
    technicalErrors.add(true);
    console.error(`Browser journey failed: ${error}`);
  } finally {
    if (bookingId) {
      try {
        await cancelBooking(page, bookingId);
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
