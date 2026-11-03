export const ASSESSMENTS = ["product-defect", "known-issue", "capture-artefact", "harness-gap"];

const SCOPE_FIELDS = ["basis", "sheets"];

function validateScope(scope) {
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) throw new Error("review scope must be an object with basis and sheets");
  for (const field of Object.keys(scope)) if (!SCOPE_FIELDS.includes(field)) throw new Error(`review scope: unknown field ${field}`);
  if (typeof scope.basis !== "string" || scope.basis.trim() === "") throw new Error("review scope: basis names what defines the scope");
  if (!Array.isArray(scope.sheets) || scope.sheets.length === 0) throw new Error("review scope: sheets lists at least one sheet");
  const seen = new Set();
  for (const entry of scope.sheets) {
    if (typeof entry !== "string" || entry === "" || entry.slice(0, -1).includes("*"))
      throw new Error(`review scope sheet ${JSON.stringify(entry)}: a sheet name or a prefix ending in *`);
    if (seen.has(entry)) throw new Error(`review scope sheet ${JSON.stringify(entry)}: listed twice`);
    seen.add(entry);
  }
}

export function validateReview(review) {
  for (const [key, entry] of Object.entries(review.assessments ?? {})) {
    if (!ASSESSMENTS.includes(entry.assessment)) throw new Error(`review ${key}: assessment must be one of ${ASSESSMENTS.join(", ")}`);
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") throw new Error(`review ${key}: reason is required`);
    if (typeof entry.followUp !== "string" || entry.followUp.trim() === "") throw new Error(`review ${key}: followUp is required`);
    if (entry.assessment === "known-issue" && !Number.isInteger(entry.issue)) throw new Error(`review ${key}: a known issue needs its issue number`);
  }
  for (const manual of review.manual ?? []) {
    if (!/^manual:[a-z0-9-]+$/.test(manual.key ?? "")) throw new Error(`review manual finding ${manual.key}: key must be manual:<slug>`);
  }
  if ("scope" in review) validateScope(review.scope);
  return review;
}

const sheetVerdict = (name, entry, keys, produced) => {
  const verdict = entry?.verdict;
  if (verdict !== "clean" && !(Array.isArray(verdict) && verdict.length > 0 && verdict.every((key) => typeof key === "string")))
    throw new Error(`review sheet ${name}: verdict must be "clean" or the keys of the findings it shows`);
  if (typeof entry.by !== "string" || entry.by.trim() === "") throw new Error(`review sheet ${name}: by names who reviewed it`);
  const unknown = verdict === "clean" || !produced ? [] : verdict.filter((key) => !keys.has(key));
  if (unknown.length) throw new Error(`review sheet ${name}: names findings this run does not hold: ${unknown.join(", ")}`);
};

const matches = (entry, name) => entry.endsWith("*") ? name.startsWith(entry.slice(0, -1)) : name === entry;

function reviewersOf(names, verdicts) {
  const counts = new Map();
  for (const name of names) counts.set(verdicts[name].by, (counts.get(verdicts[name].by) ?? 0) + 1);
  return [...counts].map(([by, sheets]) => ({ by, sheets })).sort((a, b) => b.sheets - a.sheets || a.by.localeCompare(b.by));
}

function reviewSheets(sheets, verdicts, keys, scope) {
  if (!sheets) return null;
  const names = [...sheets.names].sort();
  for (const [name, entry] of Object.entries(verdicts)) sheetVerdict(name, entry, keys, names.includes(name));
  const inScope = scope ? names.filter((name) => scope.sheets.some((entry) => matches(entry, name))) : names;
  const reviewed = inScope.filter((name) => verdicts[name]);
  return {
    total: names.length,
    reviewed,
    unreviewed: inScope.filter((name) => !verdicts[name]),
    outsideScope: names.filter((name) => !inScope.includes(name)),
    reviewers: reviewersOf(reviewed, verdicts),
    scope: scope ? { basis: scope.basis,
      stale: sheets.unavailable ? [] : scope.sheets.filter((entry) => !names.some((name) => matches(entry, name))) } : null,
    stale: Object.keys(verdicts).filter((name) => !names.includes(name)).sort(),
    unavailable: sheets.unavailable ?? null
  };
}

export function applyReview(findings, review, sheets = null) {
  validateReview(review);
  const assessments = review.assessments ?? {};
  const all = [...findings, ...(review.manual ?? []).map((manual) => ({ detail: "", where: [], ...manual }))];
  const reviewed = all.map((finding) => ({ ...finding, review: assessments[finding.key] ?? null }));
  const unassessed = reviewed.filter((finding) => finding.review === null).map((finding) => finding.key);
  const stale = Object.keys(assessments).filter((key) => !all.some((finding) => finding.key === key));
  const sheetReview = reviewSheets(sheets, review.sheets ?? {}, new Set(all.map((finding) => finding.key)), review.scope ?? null);
  const sheetsOpen = sheetReview !== null && (sheetReview.unreviewed.length > 0 || sheetReview.unavailable !== null
    || (sheetReview.scope?.stale.length ?? 0) > 0);
  return { findings: reviewed, status: unassessed.length === 0 && !sheetsOpen ? "final" : "draft", unassessed, stale, sheets: sheetReview };
}
