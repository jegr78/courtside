import { createHash } from "node:crypto";

const AXE_GRADE = { critical: "major", serious: "minor", moderate: "hint", minor: "hint" };
const EXPECTED_CONSOLE = [/Refused to apply a stylesheet/, /status of 401/, /status of 409/];
const pathOf = (url) => { try { return new URL(url).pathname; } catch { return url; } };
const normalise = (text) => text
  .replace(/https?:\/\/[^/\s]+/g, "")
  .replace(/\/?[a-z0-9-]+(\.[a-z0-9-]+)+(?=\/)/gi, "")
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
  .replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?/g, ":date")
  .replace(/\d+/g, "n");
const digest = (text) => createHash("sha256").update(normalise(text)).digest("hex").slice(0, 12);

export const findingKey = {
  axe: (rule) => `axe:${rule}`,
  console: (message) => `console:${digest(message)}`,
  http: (status, url) => `http:${status}:${normalise(pathOf(url))}`,
  failure: (file, title, project) => `failure:${file}:${title}:${project}`
};

export function collectFindings({ metrics, failures }) {
  const findings = new Map();
  const add = (key, base, where) => {
    if (!findings.has(key)) findings.set(key, { key, ...base, where: [] });
    findings.get(key).where.push(where);
  };
  for (const row of metrics) {
    const where = { project: row.project, persona: row.persona, url: pathOf(row.url), shot: row.shot };
    for (const violation of row.axe) {
      add(findingKey.axe(violation.id), { severity: AXE_GRADE[violation.impact] ?? "hint", kind: "accessibility",
        title: `axe ${violation.id} (${violation.impact})`, detail: violation.targets.slice(0, 3).join(" | ") }, where);
    }
    for (const message of row.console.filter((candidate) => !EXPECTED_CONSOLE.some((pattern) => pattern.test(candidate)))) {
      add(findingKey.console(message), { severity: "minor", kind: "console", title: `Console error: ${normalise(message).slice(0, 140)}`, detail: message.slice(0, 300) }, where);
    }
    for (const error of row.httpErrors.filter((candidate) => candidate.status >= 500)) {
      add(findingKey.http(error.status, error.url), { severity: "major", kind: "http", title: `HTTP ${error.status} ${normalise(pathOf(error.url))}`, detail: "" }, where);
    }
  }
  for (const failure of failures.filter((candidate) => candidate.class === "product")) {
    add(findingKey.failure(failure.file, failure.title, failure.project), { severity: "blocker", kind: "journey",
      title: `Journey failed: ${failure.title}`, detail: failure.error }, { project: failure.project });
  }
  return [...findings.values()];
}
