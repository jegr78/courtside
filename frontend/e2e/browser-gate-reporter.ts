import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError, TestResult } from "@playwright/test/reporter";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { classifyBrowserFailure } from "./browser-diagnostics";

type ClaimStatus = "passed" | "failed" | "incomplete" | "not-established" | "not-run";

interface GateResult {
  identity?: string;
  projectName: string;
  status: string;
  errors: ReadonlyArray<{ message?: string }>;
}

interface GateClaim {
  id: "accessibility-rule-conformance" | "webkit-core-compatibility" | "webkit-axe-qualification" | "browser-harness";
  status: ClaimStatus;
}

interface BrowserGateOutcome {
  schemaVersion: 1;
  claims: GateClaim[];
  testPopulation: { count: number; fingerprint: string };
}

interface BrowserGateOptions {
  chromiumAccessibilityRequired?: boolean;
  webkitAxeRequired?: boolean;
  globalErrors?: ReadonlyArray<TestError>;
  testPopulation?: ReadonlyArray<string>;
}

function claimStatus(results: GateResult[], projectNames: string | string[], required: boolean): { product: ClaimStatus; harnessIncomplete: boolean } {
  const names = Array.isArray(projectNames) ? projectNames : [projectNames];
  const projectResults = results.filter((result) => names.includes(result.projectName));
  if (projectResults.length === 0 || required && names.some((name) => !results.some((result) => result.projectName === name))) {
    return required
      ? { product: "not-established", harnessIncomplete: true }
      : { product: "not-run", harnessIncomplete: false };
  }
  const failures = projectResults.filter((result) => result.status !== "passed");
  if (failures.length === 0) return { product: "passed", harnessIncomplete: false };
  const classifications = failures.flatMap((result) => result.errors.length === 0
    ? ["harness-incomplete"]
    : [classifyBrowserFailure(result.errors, { pageCrashed: false, browserConnected: true })]);
  const hasHarnessFailure = classifications.some((classification) => classification !== "product-failure");
  const hasProductFailure = classifications.includes("product-failure");
  if (hasHarnessFailure) return { product: hasProductFailure ? "failed" : "not-established", harnessIncomplete: true };
  return { product: "failed", harnessIncomplete: false };
}

export function browserGateOutcome(results: GateResult[], runStatus: FullResult["status"] = "passed",
  options: BrowserGateOptions = {}): BrowserGateOutcome {
  const accessibility = claimStatus(results, "chromium-accessibility", options.chromiumAccessibilityRequired !== false);
  const webkitProjects = ["webkit-core", "webkit-pwa"];
  const webkit = claimStatus(results, webkitProjects, true);
  const webkitAxe = claimStatus(results, "webkit-accessibility", options.webkitAxeRequired === true);
  const claimProjects = new Set(["chromium-accessibility", ...webkitProjects, "webkit-accessibility"]);
  const hasUntrackedFailure = results.some((result) => !claimProjects.has(result.projectName) && result.status !== "passed");
  const hasGlobalFailure = (options.globalErrors?.length ?? 0) > 0;
  const hasClaimProductFailure = [accessibility, webkit, webkitAxe].some((claim) => claim.product === "failed");
  const unexplainedRunFailure = runStatus !== "passed" && (runStatus !== "failed" || !hasClaimProductFailure);
  const harnessIncomplete = accessibility.harnessIncomplete || webkit.harnessIncomplete || webkitAxe.harnessIncomplete
    || hasUntrackedFailure || hasGlobalFailure || unexplainedRunFailure;
  const identities = (options.testPopulation
    ?? results.map((result, index) => result.identity ?? `${result.projectName}:${index}`)).toSorted();
  return {
    schemaVersion: 1,
    testPopulation: {
      count: identities.length,
      fingerprint: `sha256:${createHash("sha256").update(JSON.stringify(identities)).digest("hex")}`
    },
    claims: [
      { id: "accessibility-rule-conformance", status: accessibility.product },
      { id: "webkit-core-compatibility", status: webkit.product },
      { id: "webkit-axe-qualification", status: webkitAxe.product },
      {
        id: "browser-harness",
        status: harnessIncomplete ? "incomplete" : "passed"
      }
    ]
  };
}

export default class BrowserGateReporter implements Reporter {
  private readonly results: GateResult[] = [];
  private readonly globalErrors: TestError[] = [];
  private testPopulation: string[] = [];

  onBegin(_config: FullConfig, suite: Suite): void {
    this.testPopulation = suite.allTests().map((test) =>
      `${test.parent.project()?.name ?? "unknown"}:${relative(process.cwd(), test.location.file)}:${test.location.line}:${test.location.column}`);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.results.push({
      identity: `${test.parent.project()?.name ?? "unknown"}:${relative(process.cwd(), test.location.file)}:${test.location.line}:${test.location.column}`,
      projectName: test.parent.project()?.name ?? "unknown",
      status: result.status,
      errors: result.errors
    });
  }

  onError(error: TestError): void {
    this.globalErrors.push(error);
  }

  onEnd(result: FullResult): void {
    const directory = resolve("test-results");
    mkdirSync(directory, { recursive: true });
    const outcome = browserGateOutcome(this.results, result.status, {
      chromiumAccessibilityRequired: process.env.COURTSIDE_WEBKIT_RELIABILITY !== "true",
      webkitAxeRequired: process.env.COURTSIDE_WEBKIT_AXE === "true",
      globalErrors: this.globalErrors,
      testPopulation: this.testPopulation
    });
    writeFileSync(resolve(directory, "browser-gate-outcome.json"),
      `${JSON.stringify(outcome, null, 2)}\n`, { mode: 0o600 });
    for (const claim of outcome.claims) process.stdout.write(`Browser gate ${claim.id}: ${claim.status}\n`);
  }
}
