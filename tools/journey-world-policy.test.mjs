import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const setup = readFileSync(new URL("../frontend/e2e/global-setup.ts", import.meta.url), "utf8");
const frontendPackage = JSON.parse(readFileSync(new URL("../frontend/package.json", import.meta.url), "utf8"));
const fixtures = readFileSync(new URL("../frontend/e2e/fixtures.ts", import.meta.url), "utf8");
const playwright = readFileSync(new URL("../frontend/playwright.config.ts", import.meta.url), "utf8");
const pwaLifecycle = readFileSync(new URL("../frontend/e2e/pwa-lifecycle.spec.ts", import.meta.url), "utf8");
const processCommand = readFileSync(new URL("../frontend/e2e/process-command.ts", import.meta.url), "utf8");
const webkitReliability = readFileSync(new URL("./webkit-reliability.mjs", import.meta.url), "utf8");
const resourceObservation = readFileSync(new URL("./browser-resource-observation.mjs", import.meta.url), "utf8");
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
const passwordResetMailLimit = readFileSync(new URL(
  "../src/main/java/org/courtside/identity/internal/PasswordResetMailLimit.java", import.meta.url), "utf8");
const passwordResetTokenService = readFileSync(new URL(
  "../src/main/java/org/courtside/identity/internal/PasswordResetTokenService.java", import.meta.url), "utf8");
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

test("given release-critical journey commands, when the runner is slow, then only the outer gate owns their deadline", () => {
  const serviceWorkerHandshake = pwaLifecycle.slice(
    pwaLifecycle.indexOf("const workerVersion"), pwaLifecycle.indexOf("expect(workerVersion)"));
  const dockerPrerequisite = webkitReliability.slice(
    webkitReliability.indexOf("export async function environmentPrerequisites"),
    webkitReliability.indexOf("async function runAttempt"));

  // when / then
  assert.doesNotMatch(setup, /executeFile/);
  assert.doesNotMatch(processCommand, /\btimeout\b/);
  assert.doesNotMatch(serviceWorkerHandshake, /setTimeout/);
  assert.match(dockerPrerequisite, /execute = runProcessToCompletion/);
  assert.doesNotMatch(dockerPrerequisite, /deadlineMs|terminationGraceMs/);
  assert.doesNotMatch(resourceObservation, /intervalMs\s*\*\s*\d/);
});

test("given a reliability browser starts, when its tests run, then resource evidence begins at its lifecycle boundary", () => {
  assert.match(setup, /browserLifecycle\.start\([^;]+;[\s\S]{0,300}await captureResourceBoundary\(\)/);
  assert.match(setup, /await captureResourceBoundary\(\);[\s\S]{0,500}browserLifecycle\.finish\(/);
});

test("given Playwright starts browsers in a container, when its package changes, then the image uses the same release", () => {
  // given
  const packageRelease = frontendPackage.devDependencies["@playwright/test"];

  // when
  const imageRelease = /mcr\.microsoft\.com\/playwright:v(?<release>\d+\.\d+\.\d+)-/.exec(setup)?.groups?.release;

  // then
  assert.equal(imageRelease, packageRelease);
});

test("given a mutable PWA asset and database, when the next test starts, then both return to their baseline", () => {
  // The club a journey installs into and the club it books in are different starts, and both are
  // snapshots the world captured rather than states a test builds.
  assert.match(setup, /snapshotJourneyData\(postgres, JOURNEY_EMPTY\)/);
  assert.match(setup, /snapshotJourneyData\(postgres, JOURNEY_SEEDED\)/);
  assert.match(setup, /resetStaticAssets\(\)/);
  // The world a project is restored to is the one its own language was taken in, never a default.
  assert.match(setup, /resetJourneyData\(postgres!, tables,\s*journeyWorldIn\(start \?\? "seeded", seededPerLanguage, language, shippedLanguage\)\)/);
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
  assert.doesNotMatch(passwordResetMailLimit, /@Scheduled/);
  assert.doesNotMatch(passwordResetTokenService, /@Scheduled/);
  assert.match(identityCleanupSchedule, /@Profile\("!journey"\)/);
  assert.equal(identityCleanupSchedule.match(/@Scheduled/g)?.length, 4);
  assert.doesNotMatch(sessionCleanupCadence, /@Profile/);
  assert.doesNotMatch(setup, /COURTSIDE_SESSION_CLEANUP_CRON: "-"/);
  assert.match(setup, /Scheduled preview expiry ran in the shared journey world/);
});
