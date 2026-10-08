import { browser } from "k6/browser";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { prepareBrowserBooking } from "./browser-journey.js";
import { consoleFailure, consoleWarning, failedRequest, journeyFailure, refusal, refusedResponse } from "./browser-diagnostics.js";

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
const browserVerifierReloads = new Counter("browser_verifier_reloads");
let firstPageLoad = { open: false, verifierChanged: false };

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

function report(description) {
  console.error(`vu=${__VU} iteration=${__ITER} ${description}`);
}

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

function observe(page) {
  page.on("requestfailed", (request) => {
    const description = failedRequest(request, target);
    if (!description) return;
    // A freshly started Chromium can change its certificate verifier while its first page loads.
    if (firstPageLoad.open && request.failure()?.errorText === "net::ERR_CERT_VERIFIER_CHANGED") {
      firstPageLoad.verifierChanged = true;
      report(`${description} on the first page load; reloading once`);
      return;
    }
    report(description);
    browserErrors.add(1);
    technicalErrors.add(true);
  });
  page.on("console", (message) => {
    const description = consoleFailure(message);
    if (description) {
      report(description);
      browserErrors.add(1);
      technicalErrors.add(true);
    }
    const warning = consoleWarning(message);
    if (warning) report(warning);
  });
  page.on("response", (response) => {
    browserRequests.add(1);
    const description = refusedResponse(response, target);
    if (description) report(description);
    if (response.status() >= 500) {
      unexpectedServerErrors.add(1);
      technicalErrors.add(true);
    }
  });
}

export default async function () {
  const started = Date.now();
  let page;
  let bookingId;
  let journeyPassed = false;
  let step = "open browser page";
  browserErrors.add(0);
  unexpectedServerErrors.add(0);
  try {
    page = await browser.newPage();
    observe(page);
    step = "open sign-in";
    firstPageLoad = { open: true, verifierChanged: false };
    try {
      await page.goto(`${target}/login`, { waitUntil: "networkidle" });
    } finally {
      firstPageLoad.open = false;
    }
    if (firstPageLoad.verifierChanged) {
      browserVerifierReloads.add(1);
      await page.reload({ waitUntil: "networkidle" });
    }
    await page.getByTestId("login-view").waitFor();
    await page.getByTestId("username").fill(username());
    await page.getByTestId("password").fill(credentials.password);
    step = "sign in";
    const eligibilityResponsePromise = page.waitForResponse(`${target}/api/booking-eligibility`);
    await page.getByTestId("login-submit").click();
    const eligibilityResponse = await eligibilityResponsePromise;
    if (eligibilityResponse.status() !== 200) throw new Error(await refusal("booking eligibility", eligibilityResponse));
    await eligibilityResponse.json();
    step = "open court plan";
    await page.getByTestId("court-plan-view").waitFor();
    await page.getByTestId("week-grid").waitFor();
    step = "prepare booking";
    await prepareBrowserBooking(page, __VU);
    step = "submit booking";
    const bookingResponsePromise = page.waitForResponse(`${target}/api/bookings`);
    await page.getByTestId("booking-submit").click();
    const response = await bookingResponsePromise;
    if (response.status() !== 201) throw new Error(await refusal("the booking UI", response));
    bookingId = (await response.json()).id;
    if (!bookingId) throw new Error("The booking UI returned no booking id");
    step = "show own booking";
    const ownAllocation = page.locator(`[data-testid="own-allocation"][data-booking-id="${bookingId}"]`);
    await ownAllocation.waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("court-plan-view").waitFor();
    step = "cancel booking";
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
    report(journeyFailure(step, error, Date.now() - started, page?.url() ?? "", target));
  } finally {
    if (bookingId) {
      try {
        await cancelBooking(page, bookingId);
      } catch (error) {
        report(journeyFailure(`clean up booking ${bookingId}`, error, Date.now() - started, page.url(), target));
        browserErrors.add(1);
        technicalErrors.add(true);
      }
    }
    browserJourneySuccess.add(journeyPassed);
    browserJourneyDuration.add(Date.now() - started);
    if (page) await page.close();
  }
}

export function handleSummary(data) {
  return { "/results/raw-summary.json": JSON.stringify(data, null, 2) };
}
