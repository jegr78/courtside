const LABEL = { "product-defect": "product defect", "known-issue": "known issue", "capture-artefact": "capture artefact", "harness-gap": "harness gap" };

export function assertPrivacySafe(markdown, forbidden) {
  const lower = markdown.toLowerCase();
  if (forbidden.usernames.some((name) => lower.includes(name.toLowerCase()))) throw new Error("release summary names a configured username");
  if (forbidden.names.some((name) => lower.includes(name.toLowerCase()))) throw new Error("release summary names a person from the roster");
  if (forbidden.hosts.some((host) => lower.includes(host.toLowerCase()))) throw new Error("release summary names the instance host");
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(markdown)) throw new Error("release summary contains an email address");
  if (/!\[[^\]]*\]\(|<img\b/i.test(markdown)) throw new Error("release summary contains an image");
  return markdown;
}

const line = (finding) => {
  const review = finding.review;
  if (!review) return `- \`${finding.key}\` ${finding.severity}: not assessed`;
  const issue = review.issue ? ` #${review.issue}` : "";
  return `- \`${finding.key}\` ${finding.severity}, ${LABEL[review.assessment]}${issue}: ${review.reason} Follow-up: ${review.followUp}`;
};

export function releaseSummary({ version, runId, harnessCommit, cells, reviewed, forbidden }) {
  const markdown = [
    `### Acceptance of ${version}`,
    "",
    reviewed.status === "final" ? "Every finding is assessed." : `Draft: ${reviewed.unassessed.length} finding(s) not assessed (${reviewed.unassessed.map((key) => `\`${key}\``).join(", ")}).`,
    "",
    `- Run \`${runId}\`, harness \`${harnessCommit}\``,
    `- Cells: ${cells.passed} passed, ${cells.failed} failed, ${cells.skipped} skipped`,
    "",
    "#### Findings",
    "",
    ...(reviewed.findings.length ? reviewed.findings.map(line) : ["None."]),
    ""
  ].join("\n");
  return assertPrivacySafe(markdown, forbidden);
}
