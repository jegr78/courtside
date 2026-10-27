import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { collectFindings } from "./findings.mjs";
import { applyReview } from "./review.mjs";
import { forbiddenTerms, releaseSummary, sheetStatus } from "./release-summary.mjs";
import { imageMagick } from "./sheets.mjs";
import { inheritSheetVerdicts, writeSheetReview } from "./sheet-inheritance.mjs";

const SEVERITY = { blocker: "Blocker", major: "Major", minor: "Minor", hint: "Hint" };
const ORDER = { blocker: 0, major: 1, minor: 2, hint: 3 };
const ASSESSMENT = { "product-defect": "Product defect", "known-issue": "Known issue", "capture-artefact": "Capture artefact", "harness-gap": "Harness gap" };
const STATUS = { ok: "✓", fail: "✗", skip: "–" };
const HIDDEN = /^(00-setup|01-discovery|02-preflight|postflight)\.spec\.ts$/;
const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const json = (path, fallback) => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
const jsonl = (path) => existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

export function serverLogSummary(logs, sources) {
  if (!sources.length) return { counted: "No log files were configured.", files: [], unread: [] };
  const unread = sources.filter((source) => source.state !== "read").map((source) => source.name);
  const files = sources.map((source) => source.state === "missing" ? `${source.name}: file missing, not read`
    : source.state === "unread" ? `${source.name}: ${source.lines} lines without the timestamp docker logs --timestamps writes, not read`
    : `${source.name}: ${source.lines} lines, ${source.inWindow} in the run window`);
  const counted = `${logs.length} WARN or ERROR lines${unread.length ? " in the files read" : ""}, ${logs.filter((line) => line.steps.length === 0).length} not attributed to a step.`;
  return { counted, files, unread };
}

export function residueSentence(residue) {
  if (!residue) return "";
  const left = residue.left === null ? "not read" : String(residue.left);
  return `Removed from the personas: ${residue.notifications} notifications, ${residue.messages} logged messages, ${residue.bookings} cancelled bookings and ${residue.series} series; left: ${left}.`;
}

export function coverageOf(results) {
  const rows = new Map();
  const cells = { passed: 0, failed: 0, skipped: 0 };
  const walk = (suite, file) => {
    for (const child of suite.suites ?? []) walk(child, child.file ?? file);
    if (HIDDEN.test(String(file).split("/").at(-1))) return;
    for (const spec of suite.specs ?? []) for (const test of spec.tests) {
      const last = test.results.at(-1);
      const status = test.status === "skipped" || last?.status === "skipped" ? "skip" : last?.status === "passed" ? "ok" : "fail";
      cells[{ ok: "passed", fail: "failed", skip: "skipped" }[status]]++;
      if (!rows.has(spec.title)) rows.set(spec.title, { flow: spec.title, cells: {} });
      rows.get(spec.title).cells[test.projectName] = { status, reason: test.annotations?.find((a) => a.type === "skip")?.description };
    }
  };
  for (const suite of results.suites ?? []) walk(suite, suite.file);
  return { rows: [...rows.values()], cells };
}

function rawGroups(metrics) {
  const groups = new Map();
  const add = (key, severity, kind, title, row) => {
    if (!groups.has(key)) groups.set(key, { severity, kind, title, n: 0, projects: new Set() });
    const group = groups.get(key); group.n++; group.projects.add(row.project);
  };
  for (const row of metrics) {
    const phone = /iphone|pixel|narrow/.test(row.project);
    if (row.documentOverflow) add(`doc ${row.label}`, phone ? "major" : "minor", "overflow", `Page scrolls sideways: ${row.label}`, row);
    for (const o of row.overflow) add(`overflow ${o.selector}`, "minor", "overflow", `Element leaves the viewport: ${o.selector}`, row);
    for (const o of row.occluded) add(`occluded ${o.selector}|${o.by}`, "minor", "occlusion", `${o.selector} covered by ${o.by}`, row);
    for (const k of row.i18nKeys) add(`i18n ${k}`, "minor", "language", `Raw message key shown: ${k}`, row);
    if (row.germanOnEn.length) add(`de-on-en ${row.label}`, "hint", "language", `German-looking text on an English page: ${row.label}`, row);
    for (const t of row.truncated) add(`trunc ${t.selector}`, "hint", "truncation", `Text cut off: ${t.selector}`, row);
    for (const t of row.smallTargets) add(`small ${t}`, "hint", "touch target", `Touch target under 44 px: ${t}`, row);
    for (const h of row.httpErrors) add(`http ${h.status} ${h.url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]}`, "hint", "http", `HTTP ${h.status} ${h.url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]}`, row);
    if (row.settled === false) add(`unsettled ${row.label}`, "major", "harness gap", `Captured while still loading, so the page is unchecked: ${row.label}`, row);
  }
  return [...groups.values()].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

function evidence(run, finding, images) {
  const shots = [...new Set(finding.where.map((where) => where.shot).filter(Boolean))].slice(0, 3);
  const figures = shots.map((shot) => {
    const source = shot.startsWith("/") ? shot : join(run, shot.slice(shot.indexOf("shots/")));
    if (!existsSync(source)) return "";
    const project = finding.where.find((where) => where.shot === shot)?.project ?? "";
    return `<figure><img loading="lazy" src="${images(source)}" alt="Screenshot ${esc(project)}"><figcaption>${esc(project)}</figcaption></figure>`;
  }).join("");
  return figures ? `<details class="ev"><summary>Show evidence</summary><div class="shots">${figures}</div></details>` : "";
}

function consoleEvidence(finding) {
  const observations = finding.where.filter((where) => where.consoleEvent);
  if (!observations.length) return "";
  return `<details class="console-context"><summary>Browser event context</summary>
${observations.map(({ project, consoleEvent: event }) => `<div>
<p>${esc(project)} · <code>${esc(event.phase)}</code> · ${esc(event.observedAt)}</p>
${event.location ? `<pre>${esc(`${event.location.url}:${event.location.lineNumber}:${event.location.columnNumber}`)}</pre>` : ""}
<pre>${esc(event.stack ?? "The browser supplied no stack.")}</pre></div>`).join("")}</details>`;
}

function card(run, finding, images) {
  const review = finding.review;
  const assessment = review
    ? `<p class="where"><span class="label">Assessment</span> ${esc(ASSESSMENT[review.assessment])}${review.issue ? ` #${review.issue}` : ""}</p>
  <p class="where"><span class="label">Reason</span> ${esc(review.reason)}</p>
  <p class="where"><span class="label">Follow-up</span> ${esc(review.followUp)}</p>`
    : `<p class="where unassessed"><span class="label">Assessment</span> not assessed</p>`;
  return `<article class="finding sev-${finding.severity}">
  <header><span class="pill">${SEVERITY[finding.severity]}</span><span class="kind">${esc(finding.kind)}</span><span class="id">${esc(finding.key)}</span></header>
  <h3>${esc(finding.title)}</h3>
  ${finding.detail ? `<p class="detail">${esc(finding.detail)}</p>` : ""}
  ${assessment}
  <p class="where"><span class="label">Where</span> ${[...new Set(finding.where.map((where) => where.project).filter(Boolean))].map(esc).join(", ")}</p>
  ${consoleEvidence(finding)}
  ${evidence(run, finding, images)}
</article>`;
}

const listOf = (findings, assessment, more = []) => [...findings.filter((finding) => finding.review?.assessment === assessment)
  .map((finding) => `<li><code>${esc(finding.key)}</code> ${esc(finding.title)}: ${esc(finding.review.reason)}</li>`), ...more].join("") || "<li>None.</li>";

const names = (list) => list.map((name) => `<li><code>${esc(name)}</code></li>`).join("");

export function sheetSection(sheets, changes) {
  if (!sheets) return "";
  const comparison = !changes ? ""
    : changes.unavailable ? `<p>Comparison with the previous run unavailable: ${esc(changes.unavailable)}.</p>`
      : `<p>Against the previous run: ${changes.changed.length} changed, ${changes.added.length} new, ${changes.unchanged} unchanged. Changed sheets and previous findings need a fresh reading.</p>
${changes.changed.length ? `<details><summary>Changed sheets</summary><ul>${names(changes.changed)}</ul></details>` : ""}
${changes.added.length ? `<details><summary>New sheets</summary><ul>${names(changes.added)}</ul></details>` : ""}`;
  return `<section><h2>Contact sheet review</h2>
<p>${sheets.unavailable ? `No contact sheets to review: ${esc(sheets.unavailable)}.` : `${sheets.reviewed.length} of ${sheets.total} contact sheets carry a verdict.`}</p>
<p>${sheets.reviewed.length - (sheets.inherited?.length ?? 0)} manually reviewed, ${sheets.inherited?.length ?? 0} inherited.</p>
${sheets.inherited?.length ? `<details><summary>Inherited verdicts</summary><ul>${sheets.inherited.map((name) => `<li><code>${esc(name)}</code> ${esc(sheets.verdicts[name].by)}</li>`).join("")}</ul></details>` : ""}
${sheets.unreviewed.length ? `<p class="unassessed">Without a verdict:</p><ul>${names(sheets.unreviewed)}</ul>` : ""}
${sheets.stale.length ? `<p>Verdicts for sheets this run did not produce:</p><ul>${names(sheets.stale)}</ul>` : ""}
${changes?.inheritanceUnavailable ? `<p>Verdict inheritance unavailable: ${esc(changes.inheritanceUnavailable)}.</p>` : ""}
${comparison}</section>`;
}

function sheetGallery(sheets, original) {
  const entries = sheets?.entries ?? [];
  if (!entries.length) return "";
  return `<section><h2>Contact sheets</h2>
${entries.map((entry) => `<details class="sheet-gallery"><summary>${esc(entry.name)}</summary><div class="sheet-scroll"><div class="sheet-tiles" style="grid-template-columns:repeat(${entry.columns},max-content)">${entry.tiles.map((tile) => {
    const viewport = original(tile.path);
    return `<figure><figcaption>${esc(tile.label)} · <a href="${viewport}">Full-size viewport</a>${tile.fullPage ? ` · <a href="${original(tile.fullPage)}">Full-page</a>` : " · Full-page unavailable"}</figcaption><a href="${viewport}"><img loading="lazy" src="${viewport}" width="${tile.width}" height="${tile.height}" alt="${esc(tile.label)} viewport"></a></figure>`;
  }).join("")}</div></div></details>`).join("")}</section>`;
}

export function renderReport(run, config, { harnessCommit, sheets = null, previous = null }) {
  const metrics = jsonl(join(run, "metrics.jsonl"));
  const failures = json(join(run, "failures.json"), []);
  const results = json(join(run, "results.json"), { suites: [] });
  const preflight = json(join(run, "preflight.json"), {});
  const lanes = json(join(run, "lanes.json"), { timeZone: "UTC", days: [] });
  const discovery = json(join(run, "discovery.json"), { lastNames: {} });
  const logs = json(join(run, "log-attribution.json"), []);
  const serverLogs = serverLogSummary(logs, json(join(run, "log-sources.json"), []));
  const postflight = json(join(run, "postflight.json"), null);
  const cleanup = json(join(run, "cleanup.json"), null);
  const residue = json(join(run, "postflight-residue.json"), null)?.residue;
  const surfaces = [...new Map(jsonl(join(run, "role-surfaces.jsonl")).map((row) => [row.key, row])).values()];
  const observations = jsonl(join(run, "observations.jsonl"));
  const reviewBytes = existsSync(join(run, "review.json")) ? readFileSync(join(run, "review.json")) : Buffer.from("null");
  const review = JSON.parse(reviewBytes.toString("utf8")) ?? { assessments: {}, manual: [] };
  const inheritance = inheritSheetVerdicts(run, previous, sheets, review);
  const reviewed = applyReview(collectFindings({ metrics, failures }), inheritance.review, sheets);
  const changes = inheritance.changes;
  if (reviewed.sheets) {
    reviewed.sheets.inherited = inheritance.inherited;
    reviewed.sheets.verdicts = inheritance.review.sheets;
  }
  writeSheetReview(run, inheritance, reviewed, createHash("sha256").update(reviewBytes).digest("hex"));
  reviewed.findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const coverage = coverageOf(results);
  const projects = [...new Set(coverage.rows.flatMap((row) => Object.keys(row.cells)))].sort();
  const version = preflight.version ?? "unknown";
  const started = existsSync(join(run, "run-started")) ? readFileSync(join(run, "run-started"), "utf8").trim() : null;
  const date = started ? new Date(started).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: lanes.timeZone }) : "unknown date";

  const directory = join(run, "report");
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(join(directory, "img"), { recursive: true });
  const tool = imageMagick();
  const images = (source) => {
    const name = `img/${createHash("sha1").update(source).digest("hex").slice(0, 12)}`;
    const [convert, args] = tool ? tool.convert([source, "-resize", "1400x2400>", "-quality", "78", join(directory, `${name}.jpg`)]) : [null, []];
    if (convert) { if (!existsSync(join(directory, `${name}.jpg`))) execFileSync(convert, args); return `${name}.jpg`; }
    if (!existsSync(join(directory, `${name}.png`))) copyFileSync(source, join(directory, `${name}.png`));
    return `${name}.png`;
  };
  const original = (source) => {
    const name = `img/${createHash("sha256").update(source).digest("hex")}.png`;
    copyFileSync(source, join(directory, name));
    return name;
  };
  const counts = Object.fromEntries(Object.keys(ORDER).map((severity) => [severity, reviewed.findings.filter((finding) => finding.severity === severity).length]));
  const status = reviewed.status === "final" ? "Final: every finding is assessed and every contact sheet carries a verdict."
    : `Draft: ${[reviewed.unassessed.length ? `${reviewed.unassessed.length} finding(s) not assessed.` : null, sheetStatus(reviewed.sheets)].filter(Boolean).join(" ")}`;
  const notChecked = [
    "The installed app's real standalone mode; Chromium does not emulate display-mode here and the app ships no display-mode CSS.",
    "Offline navigation in WebKit; Playwright WebKit aborts every offline navigation.",
    "The update notice after a real deployment; the run deploys nothing.",
    ...(config.mail ? [] : ["Every journey that reads mail; mail.url is not configured."])
  ];

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Courtside acceptance ${esc(version)}</title>
<style>
:root { --bg: #f6f7f4; --surface: #ffffff; --fg: #1d2420; --muted: #5d6b63; --line: #d9dfda; --accent: #2f6b4f;
  --blocker: #a3261b; --major: #b4530f; --minor: #7a6a12; --hint: #5d6b63; --ok: #2f6b4f;
  --body: system-ui, "Helvetica Neue", Arial, sans-serif; --mono: ui-monospace, Menlo, Consolas, monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #121614; --surface: #1a201d; --fg: #e5ebe6; --muted: #9aa9a0;
  --line: #2c3530; --accent: #7cc4a0; --blocker: #ff8a7a; --major: #ffad6b; --minor: #e2cf6a; --hint: #9aa9a0; --ok: #7cc4a0; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #121614; --surface: #1a201d; --fg: #e5ebe6; --muted: #9aa9a0; --line: #2c3530; --accent: #7cc4a0;
  --blocker: #ff8a7a; --major: #ffad6b; --minor: #e2cf6a; --hint: #9aa9a0; --ok: #7cc4a0; color-scheme: dark }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 var(--body); }
.wrap { max-width: 980px; margin: 0 auto; padding: 32px 16px 64px; display: grid; gap: 40px; }
h1, h2, h3 { margin: 0; text-wrap: balance; } h1 { font-size: 2rem; } h2 { font-size: 1.25rem; padding-bottom: 8px; border-bottom: 2px solid var(--fg); } h3 { font-size: 1rem; }
p { margin: 0; max-width: 68ch; } section { display: grid; gap: 16px; min-width: 0; }
.lede, .meta { color: var(--muted); } .meta { font-family: var(--mono); font-size: 0.8rem; }
.strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.tile { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 12px 14px; display: grid; gap: 2px; }
.tile b { font-family: var(--mono); font-size: 1.6rem; } .tile span { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; }
.tile.blocker b { color: var(--blocker); } .tile.major b { color: var(--major); } .tile.minor b { color: var(--minor); } .tile.hint b { color: var(--hint); }
.findings { display: grid; gap: 12px; }
.finding { background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--hint); border-radius: 4px; padding: 14px 16px; display: grid; gap: 8px; min-width: 0; }
.finding.sev-blocker { border-left-color: var(--blocker); } .finding.sev-major { border-left-color: var(--major); } .finding.sev-minor { border-left-color: var(--minor); }
.finding header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 0.8rem; }
.pill { font-weight: 600; text-transform: uppercase; font-size: 0.72rem; padding: 2px 8px; border-radius: 999px; border: 1px solid currentColor; }
.sev-blocker .pill { color: var(--blocker); } .sev-major .pill { color: var(--major); } .sev-minor .pill { color: var(--minor); } .sev-hint .pill { color: var(--hint); }
.kind { color: var(--muted); } .id { margin-left: auto; font-family: var(--mono); color: var(--muted); overflow-wrap: anywhere; }
.detail { color: var(--muted); font-size: 0.9rem; overflow-wrap: anywhere; }
.console-context pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.where { font-size: 0.85rem; } .unassessed { color: var(--blocker); font-weight: 600; }
.label { font-size: 0.72rem; text-transform: uppercase; color: var(--muted); margin-right: 6px; }
details summary { cursor: pointer; color: var(--accent); font-weight: 600; font-size: 0.9rem; }
details summary:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.shots { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; } .shots figure { margin: 0; flex: 1 1 260px; min-width: 0; display: grid; gap: 4px; }
.shots img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 4px; }
figcaption { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); }
.sheet-gallery { min-width: 0; }
.sheet-scroll { overflow: auto; max-width: 100%; }
.sheet-tiles { display: grid; gap: 12px; width: max-content; }
.sheet-tiles figure { margin: 0; }
.sheet-tiles img { max-width: none; display: block; }
.scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 4px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 0.82rem; } th, td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
td.st { text-align: center; font-family: var(--mono); } td.ok { color: var(--ok); } td.fail { color: var(--blocker); font-weight: 600; } td.skip { color: var(--line); }
ul { margin: 0; padding-left: 20px; display: grid; gap: 6px; max-width: 72ch; }
</style></head><body><div class="wrap">
<header style="display:grid;gap:10px">
  <p class="meta">Courtside ${esc(version)} · ${esc(date)} · run ${esc(basename(run))} · harness ${esc(harnessCommit)}</p>
  <h1>Acceptance run</h1>
  <p class="lede">${esc(status)}</p>
  ${reviewed.stale.length ? `<p class="lede">Assessments for findings this run did not produce: ${reviewed.stale.map(esc).join(", ")}.</p>` : ""}
</header>
<section aria-label="Summary"><div class="strip">
  ${Object.keys(ORDER).map((severity) => `<div class="tile ${severity}"><b>${counts[severity]}</b><span>${SEVERITY[severity]}</span></div>`).join("")}
  <div class="tile"><b>${coverage.cells.passed}/${coverage.cells.passed + coverage.cells.failed}</b><span>Cells passed</span></div>
  <div class="tile"><b>${metrics.length}</b><span>Captures</span></div>
</div></section>
<section><h2>Findings</h2><div class="findings">${reviewed.findings.map((finding) => card(run, finding, images)).join("") || "<p>None.</p>"}</div></section>
${sheetSection(reviewed.sheets, changes)}
${sheetGallery(sheets, original)}
<section><h2>Coverage</h2><p class="lede">✓ passed, ✗ failed, – not planned for this profile.</p><div class="scroll"><table><thead><tr><th>Journey</th>${projects.map((p) => `<th>${esc(p)}</th>`).join("")}</tr></thead><tbody>
${coverage.rows.map((row) => `<tr><td>${esc(row.flow)}</td>${projects.map((p) => `<td class="st ${row.cells[p]?.status ?? ""}" title="${esc(row.cells[p]?.reason ?? "")}">${row.cells[p] ? STATUS[row.cells[p].status] : ""}</td>`).join("")}</tr>`).join("")}
</tbody></table></div></section>
<section><h2>Administration surfaces per role</h2><ul>${surfaces.map((s) => `<li><b>${esc(s.key)}</b>: ${s.links.map((l) => esc(l.replace(/^admin-|-link$/g, ""))).join(", ") || "club appointments only"}</li>`).join("") || "<li>None recorded.</li>"}</ul></section>
<section><h2>Not checked</h2><ul>${notChecked.map((line) => `<li>${esc(line)}</li>`).join("")}</ul></section>
<section><h2>Rejected suspicions</h2><ul>${listOf(reviewed.findings, "capture-artefact")}</ul></section>
<section><h2>Harness gaps</h2><ul>${listOf(reviewed.findings, "harness-gap", [...observations.map((o) => `<li>${esc(o.project)}: ${esc(o.note)}</li>`),
  ...serverLogs.unread.map((name) => `<li>The server log ${esc(name)} was not read.</li>`)])}</ul></section>
<section><h2>Server logs</h2><p>${esc(serverLogs.counted)}</p>${serverLogs.files.length ? `<ul>${serverLogs.files.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>` : ""}</section>
<section><h2>Cleanup</h2><p>${postflight ? `Bookings of this run left in reserved slots: ${postflight.left.length}; club bookings in reserved slots, left untouched: ${(postflight.foreign ?? []).length}; weeks of this run removed: ${postflight.weeks.length}; club weeks left untouched: ${(postflight.foreignWeeks ?? []).length}.` : "Postflight did not run."} ${(preflight.weekendConflicts ?? []).length ? `Club bookings the weekend journeys notified their bookers about: ${preflight.weekendConflicts.length}.` : ""} ${cleanup ? `Bookings of this run left in the window: ${cleanup.diff.flatMap((d) => d.ours ?? []).length}.` : ""} ${residueSentence(residue)}</p></section>
<section><h2>Raw page checks</h2><details><summary>${metrics.length} captures, unfiltered</summary><div class="scroll"><table><thead><tr><th>Grade</th><th>Kind</th><th>Check</th><th>Count</th><th>Profiles</th></tr></thead><tbody>
${rawGroups(metrics).map((g) => `<tr><td>${SEVERITY[g.severity]}</td><td>${esc(g.kind)}</td><td>${esc(g.title)}</td><td>${g.n}</td><td>${[...g.projects].map(esc).join(", ")}</td></tr>`).join("")}
</tbody></table></div></details></section>
</div></body></html>`;
  writeFileSync(join(directory, "index.html"), html);

  const forbidden = forbiddenTerms(config, discovery);
  let summary;
  try {
    summary = releaseSummary({ version, runId: basename(run), harnessCommit, cells: coverage.cells, reviewed, forbidden });
  } catch (refusal) {
    summary = `Release summary refused: ${refusal.message}\n`;
  }
  writeFileSync(join(run, "release-summary.md"), summary);
  return { status: reviewed.status, unassessed: reviewed.unassessed, stale: reviewed.stale,
    unreviewedSheets: reviewed.sheets?.unreviewed ?? [], staleSheets: reviewed.sheets?.stale ?? [], changedSheets: changes };
}
