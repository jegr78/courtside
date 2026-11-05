const SIGNED_OUT = ["/", "/login"];
const MEMBER = ["/my-bookings", "/my-messages"];
const ADMINISTRATION = [
  "/admin", "/admin/appointments", "/admin/setup", "/admin/configuration", "/admin/deadlines", "/admin/rule-sets",
  "/admin/message-wording", "/admin/facility/courts", "/admin/facility/access-points", "/admin/facility/opening-hours",
  "/admin/facility/opening-hours/exceptions", "/admin/facility/booking-cards", "/admin/facility/booking-cards/:cardId",
  "/admin/facility/slot-fillers", "/admin/roster", "/admin/roster/:personId", "/admin/membership-types", "/admin/import",
  "/admin/export", "/admin/retention", "/admin/utilisation", "/admin/usage", "/admin/audit", "/admin/messages",
  "/admin/operational-logs", "/admin/access-grants", "/admin/operator-health"
];
export const FORM_FACTORS = ["mobile", "desktop"];

export function lighthousePlan() {
  const pages = [
    ...SIGNED_OUT.map((path) => ({ path, account: null, runs: 3 })),
    ...MEMBER.map((path) => ({ path, account: "member", runs: 3 })),
    ...ADMINISTRATION.map((path) => ({ path, account: "admin", runs: 1 }))
  ];
  return FORM_FACTORS.flatMap((formFactor) => pages.map((page) => ({ ...page, formFactor })));
}

export function resolvedPath(path, identifiers) {
  return path.replace(/:(\w+)/g, (_, name) => {
    if (!identifiers[name]) throw new Error(`No ${name} for ${path}`);
    return encodeURIComponent(identifiers[name]);
  });
}

export function landingFailure(report, path) {
  if (report.runtimeError) return `${report.runtimeError.code}: ${report.runtimeError.message}`;
  const landed = new URL(report.finalDisplayedUrl).pathname;
  return landed === path ? undefined : `landed on ${landed} instead of ${path}`;
}

const score = (report, id) => {
  const value = report.categories[id]?.score;
  return typeof value === "number" ? String(Math.round(value * 100)) : "n/a";
};
const metric = (report, id, format) => {
  const value = report.audits[id]?.numericValue;
  return typeof value === "number" ? format(value) : "n/a";
};
const milliseconds = (value) => `${Math.round(value)} ms`;

export function summaryMarkdown(results, { image, revision }) {
  const rows = results.map(({ path, formFactor, runs, report, failure }) => {
    const page = `| \`${path}\` | ${formFactor} | ${runs} |`;
    if (failure) return `${page} failed: ${failure} |`;
    return `${page} ${["performance", "accessibility", "best-practices", "seo"].map((id) => score(report, id)).join(" | ")} | `
      + `${metric(report, "first-contentful-paint", milliseconds)} | ${metric(report, "largest-contentful-paint", milliseconds)} | `
      + `${metric(report, "total-blocking-time", milliseconds)} | ${metric(report, "cumulative-layout-shift", (value) => value.toFixed(3))} | `
      + `${report.environment?.benchmarkIndex ?? "n/a"} |`;
  });
  return [
    "## Lighthouse",
    "",
    `Image \`${image}\`, revision \`${revision}\`. Pages with three runs show the median run. No score fails this report.`,
    "",
    "| Page | Form factor | Runs | Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS | Benchmark |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    ""
  ].join("\n");
}
