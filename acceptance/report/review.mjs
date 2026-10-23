export const ASSESSMENTS = ["product-defect", "known-issue", "capture-artefact", "harness-gap"];

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
  return review;
}

const sheetVerdict = (name, entry, keys) => {
  const verdict = entry?.verdict;
  if (verdict !== "clean" && !(Array.isArray(verdict) && verdict.length > 0 && verdict.every((key) => typeof key === "string")))
    throw new Error(`review sheet ${name}: verdict must be "clean" or the keys of the findings it shows`);
  if (typeof entry.by !== "string" || entry.by.trim() === "") throw new Error(`review sheet ${name}: by names who reviewed it`);
  const unknown = verdict === "clean" ? [] : verdict.filter((key) => !keys.has(key));
  if (unknown.length) throw new Error(`review sheet ${name}: names findings this run does not hold: ${unknown.join(", ")}`);
};

function reviewSheets(sheets, verdicts, keys) {
  if (!sheets) return null;
  for (const [name, entry] of Object.entries(verdicts)) sheetVerdict(name, entry, keys);
  const names = [...sheets.names].sort();
  return {
    total: names.length,
    reviewed: names.filter((name) => verdicts[name]),
    unreviewed: names.filter((name) => !verdicts[name]),
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
  const sheetReview = reviewSheets(sheets, review.sheets ?? {}, new Set(all.map((finding) => finding.key)));
  const sheetsOpen = sheetReview !== null && (sheetReview.unreviewed.length > 0 || sheetReview.unavailable !== null);
  return { findings: reviewed, status: unassessed.length === 0 && !sheetsOpen ? "final" : "draft", unassessed, stale, sheets: sheetReview };
}
