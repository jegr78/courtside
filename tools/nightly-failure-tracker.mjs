import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const allowedJobs = new Set(["backend", "frontend", "security", "build", "tool-update-comparison"]);
// A run that can be summoned is a path that can be proven; only a scheduled one counts
// towards the consecutive green nights that make an issue ready for closure.
const trackedEvents = new Set(["schedule", "workflow_dispatch"]);
const readyMarker = "<!-- courtside-nightly-ready-for-review -->";

function boundedText(value, field) {
  if (typeof value !== "string" || value.length < 1 || value.length > 120) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function safeText(value) {
  return value.replace(/[^A-Za-z0-9 ._:/()-]/g, "?");
}

function validateRun(run) {
  if (run?.name !== "build" || !trackedEvents.has(run.event)) throw new Error("workflow is invalid");
  if (!Number.isSafeInteger(run.id) || run.id < 1) throw new Error("run id is invalid");
  if (run.run_attempt !== 1) throw new Error("only the first attempt is valid");
  if (!/^[a-f0-9]{40}$/.test(run.head_sha ?? "")) throw new Error("commit is invalid");
  const url = new URL(run.html_url);
  if (url.protocol !== "https:" || url.hostname !== "github.com" ||
      !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*$/.test(url.pathname) ||
      !url.pathname.endsWith(`/actions/runs/${run.id}`) || url.search || url.hash) {
    throw new Error("run URL is invalid");
  }
}

export function classifyNightlyFailures(run, jobs) {
  validateRun(run);
  if (!Array.isArray(jobs) || jobs.length > 100) throw new Error("jobs are invalid");
  return jobs.filter((job) => ["failure", "cancelled", "timed_out"].includes(job?.conclusion)).flatMap((job) => {
    const failedSteps = (job.steps ?? []).filter((step) =>
      ["failure", "cancelled", "timed_out"].includes(step?.conclusion));
    const classes = failedSteps.length > 0 ? failedSteps : [{ name: "job", conclusion: job.conclusion }];
    return classes.map((failedStep) => {
      const rawStep = boundedText(failedStep.name, "step");
      const step = safeText(rawStep);
      const failureClass = failedStep.conclusion;
      const jobName = allowedJobs.has(job.name) ? job.name : safeText(boundedText(job.name, "job"));
      const identity = JSON.stringify({ schemaVersion: 1, workflow: "build", job: jobName,
        step: rawStep, failureClass });
      return {
        fingerprint: createHash("sha256").update(identity).digest("hex"),
        workflow: "build",
        job: jobName,
        step,
        failureClass,
        runId: run.id,
        attempt: 1,
        commit: run.head_sha,
        runUrl: run.html_url
      };
    });
  });
}

function occurrenceMarker(failure) {
  return `<!-- courtside-nightly-occurrence:${failure.runId}:${failure.attempt} -->`;
}

function occurrence(failure) {
  const range = failure.baseCommit ? `${failure.baseCommit}..${failure.commit}` : failure.commit;
  return `${occurrenceMarker(failure)}\n- First-attempt commit range \`${range}\`: ${failure.runUrl}`;
}

export function bindCommitRange(failures, recentRuns) {
  const previous = recentRuns.find((recent) => recent?.run_attempt === 1 && recent.event === "schedule" &&
    recent.conclusion === "success" && /^[a-f0-9]{40}$/.test(recent.head_sha ?? ""));
  return failures.map((failure) => ({ ...failure, baseCommit: previous?.head_sha ?? null }));
}

export function planFailureUpdates(failures, issues) {
  if (!Array.isArray(failures) || !Array.isArray(issues)) throw new Error("tracker input is invalid");
  if (issues.some((issue) => !["open", "closed"].includes(issue?.state))) throw new Error("issue state is invalid");
  return failures.flatMap((failure) => {
    const fingerprintMarker = `<!-- courtside-nightly-fingerprint:${failure.fingerprint} -->`;
    const existing = issues.find((issue) => Number.isSafeInteger(issue.number) && issue.number > 0 &&
      `${issue.title ?? ""}`.startsWith("[nightly] ") &&
      `${issue.body ?? ""}\n${issue.comments ?? ""}`.includes(fingerprintMarker));
    const knownContent = existing ? `${existing.body ?? ""}\n${existing.comments ?? ""}` : "";
    if (knownContent.includes(occurrenceMarker(failure))) return [];
    if (existing) {
      return [{ action: existing.state === "closed" ? "reopen" : "comment",
        issueNumber: existing.number, body: occurrence(failure) }];
    }
    return [{
      action: "create",
      issueNumber: null,
      title: `[nightly] ${failure.job} / ${failure.step} (${failure.fingerprint.slice(0, 12)})`,
      body: `${fingerprintMarker}\nA scheduled first-attempt build failed with this stable class.\n\n` +
        `- Workflow: \`${failure.workflow}\`\n- Job: \`${failure.job}\`\n- Step: \`${failure.step}\`\n` +
        `- Failure class: \`${failure.failureClass}\`\n\n${occurrence(failure)}\n\n` +
        "Keep this issue open until the tracker marks seven consecutive first-attempt nightlies green and a human verifies closure.",
      labels: ["bug"]
    }];
  });
}

// Anybody may comment on a public issue, and a fingerprint is a hash over values anybody can
// enumerate. Only what this tracker wrote itself is its own state.
export function trustedCommentText(comments) {
  return (Array.isArray(comments) ? comments : [])
    .filter((comment) => comment?.user?.type === "Bot")
    .map((comment) => comment.body ?? "")
    .join("\n");
}

export function readyForReview(runs) {
  return Array.isArray(runs) && runs.length >= 7 && runs.slice(0, 7).every((run) =>
    run?.event === "schedule" && run.run_attempt === 1 && run.conclusion === "success");
}

export async function applyIssuePlan(plan, request, repository = "example/courtside") {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("repository is invalid");
  for (const item of plan) {
    if (item.action === "reopen") {
      const reopened = await request(`https://api.github.com/repos/${repository}/issues/${item.issueNumber}`, {
        method: "PATCH", body: JSON.stringify({ state: "open" })
      });
      if (!reopened.ok) throw new Error(`GitHub API returned ${reopened.status}`);
    }
    const endpoint = item.action === "create"
      ? `https://api.github.com/repos/${repository}/issues`
      : `https://api.github.com/repos/${repository}/issues/${item.issueNumber}/comments`;
    const payload = item.action === "create"
      ? { title: item.title, body: item.body, labels: item.labels }
      : { body: item.body };
    const response = await request(endpoint, { method: "POST", body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  }
}

async function githubRequest(token, endpoint, options = {}) {
  return fetch(endpoint, {
    ...options,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
      "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" }
  });
}

async function readPages(request, endpoint, maximumPages = 10) {
  const values = [];
  let next = endpoint;
  for (let page = 0; next && page < maximumPages; page += 1) {
    const response = await request(next);
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length > 100) throw new Error("GitHub API page is invalid");
    values.push(...payload);
    const link = response.headers.get("link") ?? "";
    const match = link.split(",").map((part) => part.trim()).find((part) => part.endsWith('rel="next"'))
      ?.match(/^<([^>]+)>;/);
    next = match?.[1] ?? null;
    if (next && (!next.startsWith("https://api.github.com/") || page + 1 === maximumPages)) {
      throw new Error("GitHub API pagination is invalid");
    }
  }
  return values;
}

async function readTrackedIssues(repository, token) {
  const request = (endpoint, options) => githubRequest(token, endpoint, options);
  const raw = await readPages(request,
    `https://api.github.com/repos/${repository}/issues?state=all&labels=bug&per_page=100`);
  const issues = raw.filter((issue) => !issue.pull_request && `${issue.title ?? ""}`.startsWith("[nightly] ") &&
    `${issue.body ?? ""}`.includes("courtside-nightly-fingerprint"));
  for (const issue of issues) {
    const comments = await readPages(request,
      `https://api.github.com/repos/${repository}/issues/${issue.number}/comments?per_page=100`);
    issue.comments = trustedCommentText(comments);
  }
  return issues;
}

async function main(args) {
  const values = Object.fromEntries(args.reduce((pairs, value, index) => {
    if (index % 2 === 0) pairs.push([value, args[index + 1]]);
    return pairs;
  }, []));
  const repository = values["--repository"];
  const token = process.env.GH_TOKEN;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") || !token) {
    throw new Error("repository and GH_TOKEN are required");
  }
  const run = JSON.parse(readFileSync(values["--run"], "utf8"));
  const jobs = JSON.parse(readFileSync(values["--jobs"], "utf8")).jobs;
  const recent = JSON.parse(readFileSync(values["--recent"], "utf8")).workflow_runs;
  const issues = await readTrackedIssues(repository, token);
  const request = (endpoint, options) => githubRequest(token, endpoint, options);
  const failures = bindCommitRange(classifyNightlyFailures(run, jobs), recent.filter((item) => item.id !== run.id));
  await applyIssuePlan(planFailureUpdates(failures, issues), request, repository);
  if (failures.length === 0 && readyForReview(recent)) {
    const plan = issues.filter((issue) => {
      const content = `${issue.body}\n${issue.comments}`;
      return issue.state === "open" && content.lastIndexOf(readyMarker) <
        content.lastIndexOf("<!-- courtside-nightly-occurrence:");
    }).map((issue) => ({
      action: "comment",
      issueNumber: issue.number,
      body: `${readyMarker}\nSeven consecutive scheduled first attempts passed. This issue is ready for human closure review; it remains open.`
    }));
    await applyIssuePlan(plan, request, repository);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
