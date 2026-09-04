import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const servicePatterns = [/\b502\b.*bad gateway/i, /\b503\b.*service unavailable/i,
  /\b504\b.*gateway timeout/i];
const networkPatterns = [/\bEAI_AGAIN\b/i, /\bECONNRESET\b/i, /\bENETUNREACH\b/i, /\bETIMEDOUT\b/i,
  /network timeout/i];

function isAuditReport(value) {
  return typeof value?.auditReportVersion === "number"
    && value.vulnerabilities !== null
    && !Array.isArray(value.vulnerabilities)
    && typeof value.vulnerabilities === "object";
}

export function classifyAuditAttempt({ status, stdout, stderr }) {
  const output = stdout.trim();
  if (output !== "") {
    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new Error("npm audit did not produce valid JSON");
    }
    if (isAuditReport(parsed)) return { status: "completed", report: parsed };
    if (Object.keys(parsed ?? {}).length === 1 && parsed?.error) {
      const error = typeof parsed.error === "string" ? parsed.error : parsed.error.summary ?? "";
      const code = typeof parsed.error === "object" ? parsed.error.code : "";
      if (["E502", "E503", "E504"].includes(code) || servicePatterns.some((pattern) => pattern.test(error))) {
        return skipped("service-unavailable");
      }
      if (networkPatterns.some((pattern) => pattern.test(`${code} ${error}`))) {
        return skipped("network-unavailable");
      }
    }
    throw new Error("npm audit did not produce a valid audit report");
  }
  if (status === 0) throw new Error("npm audit produced no report");
  if (servicePatterns.some((pattern) => pattern.test(stderr))) return skipped("service-unavailable");
  if (networkPatterns.some((pattern) => pattern.test(stderr))) return skipped("network-unavailable");
  throw new Error("npm audit failed with an unclassified error");
}

function skipped(reason) {
  return { status: "skipped", report: { schemaVersion: 1, status: "skipped", reason } };
}

export function runAudit({ output }, execute = executeNpmAudit) {
  const result = classifyAuditAttempt(execute());
  const target = resolve(output);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(result.report, null, 2)}\n`, { mode: 0o600 });
  chmodSync(target, 0o600);
  return result;
}

function executeNpmAudit() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !isAbsolute(npmCli)) throw new Error("Run npm audit through the audit:security package script");
  return spawnSync(process.execPath, [npmCli, "audit", "--json", "--audit-level=high"], {
    cwd: process.cwd(), encoding: "utf8", env: process.env
  });
}

function parseArguments(args) {
  if (args.length !== 2 || args[0] !== "--output" || !args[1]) {
    throw new Error("Usage: npm run audit:security -- --output <path>");
  }
  return { output: args[1] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = runAudit(parseArguments(process.argv.slice(2)));
    process.stdout.write(`npm audit ${result.status}\n`);
  } catch (failure) {
    process.stderr.write(`${failure.message}\n`);
    process.exitCode = 1;
  }
}
