import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyBrowserFailure } from "./browser-diagnostics";

type ClaimStatus = "passed" | "failed" | "incomplete" | "not-established" | "not-run";

interface GateResult {
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
}

function claimStatus(results: GateResult[], projectName: string): { product: ClaimStatus; harnessIncomplete: boolean } {
  const projectResults = results.filter((result) => result.projectName === projectName);
  if (projectResults.length === 0) return { product: "not-run", harnessIncomplete: false };
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

export function browserGateOutcome(results: GateResult[], runStatus: FullResult["status"] = "passed"): BrowserGateOutcome {
  const accessibility = claimStatus(results, "chromium-accessibility");
  const webkit = claimStatus(results, "webkit-core");
  const webkitAxe = claimStatus(results, "webkit-accessibility");
  return {
    schemaVersion: 1,
    claims: [
      { id: "accessibility-rule-conformance", status: accessibility.product },
      { id: "webkit-core-compatibility", status: webkit.product },
      { id: "webkit-axe-qualification", status: webkitAxe.product },
      {
        id: "browser-harness",
        status: runStatus !== "passed" && results.length === 0 ? "incomplete"
          : results.length === 0 ? "not-run"
          : accessibility.harnessIncomplete || webkit.harnessIncomplete || webkitAxe.harnessIncomplete
            ? "incomplete" : "passed"
      }
    ]
  };
}

export default class BrowserGateReporter implements Reporter {
  private readonly results: GateResult[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    this.results.push({
      projectName: test.parent.project()?.name ?? "unknown",
      status: result.status,
      errors: result.errors
    });
  }

  onEnd(result: FullResult): void {
    const directory = resolve("test-results");
    mkdirSync(directory, { recursive: true });
    const outcome = browserGateOutcome(this.results, result.status);
    writeFileSync(resolve(directory, "browser-gate-outcome.json"),
      `${JSON.stringify(outcome, null, 2)}\n`, { mode: 0o600 });
    for (const claim of outcome.claims) process.stdout.write(`Browser gate ${claim.id}: ${claim.status}\n`);
  }
}
