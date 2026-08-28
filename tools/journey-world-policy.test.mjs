import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const setup = readFileSync(new URL("../frontend/e2e/global-setup.ts", import.meta.url), "utf8");
const fixtures = readFileSync(new URL("../frontend/e2e/fixtures.ts", import.meta.url), "utf8");
const playwright = readFileSync(new URL("../frontend/playwright.config.ts", import.meta.url), "utf8");
const bookingReminders = readFileSync(new URL(
  "../src/main/java/org/courtside/booking/internal/BookingReminders.java", import.meta.url), "utf8");
const bookingReminderSchedule = readFileSync(new URL(
  "../src/main/java/org/courtside/booking/internal/BookingReminderSchedule.java", import.meta.url), "utf8");
const previewExpiry = readFileSync(new URL(
  "../src/main/java/org/courtside/dataexchange/internal/PreviewExpiry.java", import.meta.url), "utf8");
const previewExpirySchedule = readFileSync(new URL(
  "../src/main/java/org/courtside/dataexchange/internal/PreviewExpirySchedule.java", import.meta.url), "utf8");
const credentialIssueLimit = readFileSync(new URL(
  "../src/main/java/org/courtside/identity/internal/CredentialIssueLimit.java", import.meta.url), "utf8");
const loginAttemptCleanup = readFileSync(new URL(
  "../src/main/java/org/courtside/identity/internal/LoginAttemptCleanup.java", import.meta.url), "utf8");
const identityCleanupSchedule = readFileSync(new URL(
  "../src/main/java/org/courtside/identity/internal/IdentityCleanupSchedule.java", import.meta.url), "utf8");
const sessionCleanupCadence = readFileSync(new URL(
  "../src/main/java/org/courtside/identity/internal/SessionCleanupCadence.java", import.meta.url), "utf8");

test("given several browser projects, when Playwright runs them, then one global journey world serves every worker", () => {
  assert.match(setup, /const service = await startJourneyService\(\)/);
  assert.doesNotMatch(setup, /for \(const browserName of browserNames\)/);
  assert.match(fixtures, /journeyService\.releasePinnedBrowser\(browserName\)/);
  assert.match(setup, /process\.env\.COURTSIDE_JOURNEY_CONTROL/);
  assert.doesNotMatch(fixtures, /startJourneyService/);
  assert.doesNotMatch(fixtures, /service\.stop/);
  assert.match(playwright, /workers: 1/);
  assert.match(playwright, /timeout: 60_000/);
  assert.match(playwright, /Unsupported browser project order/);
});

test("given a mutable PWA asset and database, when the next test starts, then both return to their baseline", () => {
  assert.match(setup, /resetStaticAssets\(\)/);
  assert.match(setup, /resetJourneyData\(postgres!, tables\)/);
});

test("given journey data is restored while the application stays live, when the test world starts, then scheduled database work never falls due", () => {
  assert.match(setup, /SPRING_PROFILES_ACTIVE: "journey"/);
  assert.match(setup, /const JOURNEY_SESSION_CLEANUP_CRON = "0 0 0 29 2 \*"/);
  assert.doesNotMatch(bookingReminders, /@Scheduled/);
  assert.doesNotMatch(previewExpiry, /@Scheduled/);
  assert.match(bookingReminderSchedule, /@Profile\("!journey"\)/);
  assert.match(bookingReminderSchedule, /@Scheduled/);
  assert.match(previewExpirySchedule, /@Profile\("!journey"\)/);
  assert.match(previewExpirySchedule, /@Scheduled/);
  assert.doesNotMatch(credentialIssueLimit, /@Scheduled/);
  assert.doesNotMatch(loginAttemptCleanup, /@Scheduled/);
  assert.match(identityCleanupSchedule, /@Profile\("!journey"\)/);
  assert.equal(identityCleanupSchedule.match(/@Scheduled/g)?.length, 2);
  assert.doesNotMatch(sessionCleanupCadence, /@Profile/);
  assert.doesNotMatch(setup, /COURTSIDE_SESSION_CLEANUP_CRON: "-"/);
  assert.match(setup, /Scheduled preview expiry ran in the shared journey world/);
});
