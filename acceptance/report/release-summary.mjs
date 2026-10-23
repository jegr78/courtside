const LABEL = { "product-defect": "product defect", "known-issue": "known issue", "capture-artefact": "capture artefact", "harness-gap": "harness gap" };

const escape = (term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (markdown, terms, flags = "iu") => terms.filter(Boolean).some((term) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`, flags).test(markdown));

export function forbiddenTerms(config, discovery) {
  const roster = discovery.roster ?? [];
  return {
    usernames: [...new Set([...Object.values(config.personas), ...(config.disposables ?? []), ...roster.map((entry) => entry.username)].filter(Boolean))],
    hosts: [new URL(config.baseUrl).hostname],
    names: [...new Set(roster.filter((entry) => entry.firstName && entry.lastName)
      .flatMap((entry) => [`${entry.firstName} ${entry.lastName}`, `${entry.lastName}, ${entry.firstName}`]))],
    nameParts: [...new Set(roster.flatMap((entry) => [entry.firstName, entry.lastName]).filter(Boolean))]
  };
}

export function assertPrivacySafe(markdown, forbidden, written = markdown) {
  if (mentions(markdown, forbidden.usernames)) throw new Error("release summary names a configured username");
  // A name part counts only as written and only in review text, so neither "the admin" nor the template's own words match.
  if (mentions(markdown, forbidden.names) || mentions(written, forbidden.nameParts ?? [], "u")) throw new Error("release summary names a person from the roster");
  if (mentions(markdown, forbidden.hosts)) throw new Error("release summary names the instance host");
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

const keys = (names) => names.map((name) => `\`${name}\``).join(", ");

export function sheetStatus(sheets) {
  if (!sheets) return null;
  if (sheets.unavailable) return `No contact sheets to review: ${sheets.unavailable}.`;
  if (sheets.unreviewed.length) return `${sheets.unreviewed.length} of ${sheets.total} contact sheet(s) without a verdict (${keys(sheets.unreviewed)}).`;
  return null;
}

function statusLine(reviewed) {
  const sheets = reviewed.sheets ?? null;
  if (reviewed.status === "final") return sheets ? `Every finding is assessed and all ${sheets.total} contact sheets carry a verdict.` : "Every finding is assessed.";
  const open = [reviewed.unassessed.length ? `${reviewed.unassessed.length} finding(s) not assessed (${keys(reviewed.unassessed)}).` : null, sheetStatus(sheets)];
  return `Draft: ${open.filter(Boolean).join(" ")}`;
}

export function releaseSummary({ version, runId, harnessCommit, cells, reviewed, forbidden }) {
  const markdown = [
    `### Acceptance of ${version}`,
    "",
    statusLine(reviewed),
    "",
    `- Run \`${runId}\`, harness \`${harnessCommit}\``,
    `- Cells: ${cells.passed} passed, ${cells.failed} failed, ${cells.skipped} skipped`,
    "",
    "#### Findings",
    "",
    ...(reviewed.findings.length ? reviewed.findings.map(line) : ["None."]),
    ""
  ].join("\n");
  const written = reviewed.findings.flatMap((finding) => finding.review ? [finding.review.reason, finding.review.followUp] : []).join("\n");
  return assertPrivacySafe(markdown, forbidden, written);
}
