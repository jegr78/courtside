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

export function applyReview(findings, review) {
  validateReview(review);
  const assessments = review.assessments ?? {};
  const all = [...findings, ...(review.manual ?? []).map((manual) => ({ detail: "", where: [], ...manual }))];
  const reviewed = all.map((finding) => ({ ...finding, review: assessments[finding.key] ?? null }));
  const unassessed = reviewed.filter((finding) => finding.review === null).map((finding) => finding.key);
  const stale = Object.keys(assessments).filter((key) => !all.some((finding) => finding.key === key));
  return { findings: reviewed, status: unassessed.length === 0 ? "final" : "draft", unassessed, stale };
}
