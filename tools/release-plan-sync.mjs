import { fileURLToPath } from "node:url";

export const statusStart = "<!-- courtside-release-plan-status:start -->";
export const statusEnd = "<!-- courtside-release-plan-status:end -->";
const contractPattern = /<!-- courtside-release-plan-contract:(\{[^\n]+\}) -->/g;

function validRepository(repository) {
  return typeof repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository);
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} is invalid`);
  return value;
}

function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} is invalid`);
  return value;
}

function safeTitle(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 500) {
    throw new Error("issue title is invalid");
  }
  return value.normalize("NFKC").replace(/[\r\n\t]+/g, " ")
    .replace(/[^\p{L}\p{N} ·.,;:()&/+!?'-]/gu, "?").replace(/\s+/g, " ").trim().slice(0, 180);
}

export function parseContract(body) {
  if (typeof body !== "string") throw new Error("release plan body is invalid");
  const matches = [...body.matchAll(contractPattern)];
  if (matches.length !== 1) throw new Error("release plan contract marker is missing or duplicated");
  let contract;
  try {
    contract = JSON.parse(matches[0][1]);
  } catch {
    throw new Error("release plan contract is invalid");
  }
  if (contract === null || Array.isArray(contract) ||
      JSON.stringify(Object.keys(contract).sort()) !== JSON.stringify(["children", "release", "statusComment"])) {
    throw new Error("release plan contract fields are invalid");
  }
  if (!/^v\d+\.\d+\.\d+$/.test(contract.release ?? "")) throw new Error("release plan release is invalid");
  positiveInteger(contract.statusComment, "release plan status comment");
  if (!Array.isArray(contract.children) || contract.children.length < 1 || contract.children.length > 100) {
    throw new Error("release plan children are invalid");
  }
  contract.children.forEach((value) => positiveInteger(value, "release plan child"));
  if (new Set(contract.children).size !== contract.children.length) {
    throw new Error("release plan children contain duplicates");
  }
  return contract;
}

function statusMarkers(body) {
  const starts = body.split(statusStart).length - 1;
  const ends = body.split(statusEnd).length - 1;
  const start = body.indexOf(statusStart);
  const end = body.indexOf(statusEnd);
  if (starts !== 1 || ends !== 1 || start >= end) {
    throw new Error("release plan status markers are missing, duplicated or reversed");
  }
  return { start, end };
}

export function replaceStatus(body, status) {
  if (typeof status !== "string" || !status.endsWith("\n")) throw new Error("release plan status is invalid");
  const markers = statusMarkers(body);
  return `${body.slice(0, markers.start)}${statusStart}\n${status}${statusEnd}` +
    body.slice(markers.end + statusEnd.length);
}

function validateIssue(issue, field) {
  if (issue === null || typeof issue !== "object" || Array.isArray(issue)) throw new Error(`${field} is invalid`);
  positiveInteger(issue.number, `${field} number`);
  if (!["open", "closed"].includes(issue.state)) throw new Error(`${field} state is invalid`);
  safeTitle(issue.title);
  const summary = issue.sub_issues_summary ?? { completed: 0, total: 0 };
  count(summary.completed, `${field} completed sub-issues`);
  count(summary.total, `${field} total sub-issues`);
  if (summary.completed > summary.total) throw new Error(`${field} sub-issue summary is invalid`);
  return summary;
}

function validateMilestone(milestone, expectedNumber) {
  if (milestone === null || typeof milestone !== "object" || Array.isArray(milestone) ||
      milestone.number !== expectedNumber || typeof milestone.title !== "string" || milestone.title.length < 1) {
    throw new Error("release plan milestone is invalid");
  }
  count(milestone.open_issues, "milestone open issues");
  count(milestone.closed_issues, "milestone closed issues");
}

function markdownIssue(repository, issue) {
  const mark = issue.state === "closed" ? "x" : " ";
  const summary = issue.sub_issues_summary ?? { completed: 0, total: 0 };
  const nested = summary.total > 0 ? `; ${summary.completed}/${summary.total} sub-issues closed` : "";
  return `- [${mark}] [#${issue.number}](https://github.com/${repository}/issues/${issue.number}) ` +
    `${safeTitle(issue.title)} (${issue.state}${nested})`;
}

export function releasePlanStatus({ repository, parent, children, milestone, releasePublished, synchronizedAt }) {
  if (!validRepository(repository)) throw new Error("repository is invalid");
  validateIssue(parent, "release plan parent");
  if (!Array.isArray(children) || children.length < 1 || children.length > 100) {
    throw new Error("release plan children are invalid");
  }
  children.forEach((issue) => validateIssue(issue, "release plan child"));
  if (!Number.isSafeInteger(parent.milestone?.number)) throw new Error("release plan parent has no milestone");
  validateMilestone(milestone, parent.milestone.number);
  if (typeof releasePublished !== "boolean" || !(synchronizedAt instanceof Date) ||
      Number.isNaN(synchronizedAt.valueOf())) throw new Error("release plan observation is invalid");

  const directClosed = children.filter((issue) => issue.state === "closed").length;
  const milestoneOpen = milestone.open_issues - (parent.state === "open" ? 1 : 0);
  const milestoneClosed = milestone.closed_issues - (parent.state === "closed" ? 1 : 0);
  if (milestoneOpen < 0 || milestoneClosed < 0) throw new Error("milestone does not contain the release parent");
  const nestedComplete = children.every((issue) => {
    const summary = issue.sub_issues_summary ?? { completed: 0, total: 0 };
    return summary.completed === summary.total;
  });
  const workComplete = directClosed === children.length && nestedComplete && milestoneOpen === 0;
  const complete = workComplete && releasePublished;
  const state = complete ? "COMPLETE" : workComplete ? "READY FOR RELEASE" : "BLOCKED";
  const release = parseContract(parent.body).release;
  const text = [
    "## Automatically synchronized status",
    "",
    `_Last successful synchronization: \`${synchronizedAt.toISOString()}\`_`,
    "",
    `- Plan state: **${state}**`,
    `- Direct work: **${directClosed}/${children.length} closed**`,
    `- ${safeTitle(milestone.title)} excluding this parent: **${milestoneClosed}/` +
      `${milestoneClosed + milestoneOpen} closed**`,
    `- Release ${release}: **${releasePublished ? "published" : "not published"}**`,
    "",
    ...children.map((issue) => markdownIssue(repository, issue)),
    ""
  ].join("\n");
  return { text, complete, workComplete, milestoneOpen, releasePublished };
}

async function get(request, endpoint, allowedStatus = new Set()) {
  const response = await request(endpoint);
  if (allowedStatus.has(response.status)) return null;
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  return response.json();
}

async function getSinglePage(request, endpoint) {
  const response = await request(endpoint);
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  const link = response.headers?.get?.("link") ?? "";
  if (/(?:^|,)\s*<[^>]+>;\s*rel="next"(?:,|$)/.test(link)) {
    throw new Error("release plan has more sub-issues than one verified page");
  }
  return response.json();
}

function api(repository, path) {
  return `https://api.github.com/repos/${repository}/${path}`;
}

export async function isRelevantIssue({ request, repository, parentNumber, eventIssueNumber, eventMilestoneNumber }) {
  if (typeof request !== "function" || !validRepository(repository)) throw new Error("relevance input is invalid");
  positiveInteger(parentNumber, "release plan issue");
  positiveInteger(eventIssueNumber, "event issue");
  if (eventMilestoneNumber !== undefined) count(eventMilestoneNumber, "event milestone");
  const parent = await get(request, api(repository, `issues/${parentNumber}`));
  validateIssue(parent, "release plan parent");
  if (parent.number !== parentNumber || !Number.isSafeInteger(parent.milestone?.number)) {
    throw new Error("release plan parent is invalid");
  }
  if (eventIssueNumber === parentNumber) return true;
  if (eventMilestoneNumber === parent.milestone.number) return true;
  let issue = await get(request, api(repository, `issues/${eventIssueNumber}`));
  validateIssue(issue, "event issue");
  if (issue.number !== eventIssueNumber) throw new Error("event issue number is invalid");
  if (issue.milestone?.number === parent.milestone.number) return true;
  const visited = new Set([eventIssueNumber]);
  for (let depth = 0; depth < 20; depth += 1) {
    issue = await get(request, api(repository, `issues/${issue.number}/parent`), new Set([404]));
    if (issue === null) return false;
    validateIssue(issue, "issue parent");
    if (issue.number === parentNumber) return true;
    if (visited.has(issue.number)) throw new Error("issue parent relationship contains a cycle");
    visited.add(issue.number);
  }
  throw new Error("issue parent relationship is too deep");
}

export async function synchronizeReleasePlan({ request, repository, issueNumber, synchronizedAt = new Date() }) {
  if (typeof request !== "function" || !validRepository(repository)) throw new Error("sync input is invalid");
  positiveInteger(issueNumber, "release plan issue");
  const parentUrl = api(repository, `issues/${issueNumber}`);
  const parent = await get(request, parentUrl);
  validateIssue(parent, "release plan parent");
  if (parent.number !== issueNumber) throw new Error("release plan parent number is invalid");
  const contract = parseContract(parent.body);
  const statusCommentUrl = api(repository, `issues/comments/${contract.statusComment}`);
  const statusComment = await get(request, statusCommentUrl);
  if (statusComment === null || typeof statusComment !== "object" || Array.isArray(statusComment) ||
      statusComment.id !== contract.statusComment || statusComment.issue_url !== parentUrl ||
      typeof statusComment.body !== "string") {
    throw new Error("release plan status comment is invalid");
  }
  statusMarkers(statusComment.body);
  const children = await getSinglePage(request, `${parentUrl}/sub_issues?per_page=100`);
  if (!Array.isArray(children)) throw new Error("GitHub sub-issues response is invalid");
  if (JSON.stringify(children.map((issue) => issue.number)) !== JSON.stringify(contract.children)) {
    throw new Error("release plan contract and sub-issue order differ");
  }
  if (!Number.isSafeInteger(parent.milestone?.number)) throw new Error("release plan parent has no milestone");
  const milestone = await get(request, api(repository, `milestones/${parent.milestone.number}`));
  const published = await get(request, api(repository, `releases/tags/${contract.release}`), new Set([404]));
  const releasePublished = published !== null && published.tag_name === contract.release &&
    published.draft === false && published.prerelease === false;
  if (published !== null && !releasePublished) throw new Error("release record is invalid");
  const status = releasePlanStatus({ repository, parent, children, milestone, releasePublished, synchronizedAt });
  const commentBody = replaceStatus(statusComment.body, `${status.text}\n`);
  const reopen = parent.state === "closed" && !status.complete;
  const commentPatch = await request(statusCommentUrl, {
    method: "PATCH", body: JSON.stringify({ body: commentBody })
  });
  if (!commentPatch.ok) throw new Error(`GitHub API returned ${commentPatch.status}`);
  if (reopen) {
    const statePatch = await request(parentUrl, {
      method: "PATCH", body: JSON.stringify({ state: "open" })
    });
    if (!statePatch.ok) throw new Error(`GitHub API returned ${statePatch.status}`);
    const reasons = [status.workComplete ? null : "required work remains open",
      status.releasePublished ? null : `${contract.release} is not published`].filter(Boolean).join("; ");
    const comment = await request(`${parentUrl}/comments`, {
      method: "POST", body: JSON.stringify({ body: `The release plan was reopened automatically: ${reasons}.` })
    });
    if (!comment.ok) throw new Error(`GitHub API returned ${comment.status}`);
  }
  return { ...status, reopened: reopen };
}

function githubRequest(token, endpoint, options = {}) {
  return fetch(endpoint, { ...options, headers: { Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`, "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28" } });
}

function argumentsOf(args) {
  if (args.length % 2 !== 0) throw new Error("arguments are invalid");
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!["--repository", "--issue", "--relevant-issue", "--event-milestone"].includes(args[index]) ||
        values[args[index]] !== undefined) {
      throw new Error("arguments are invalid");
    }
    values[args[index]] = args[index + 1];
  }
  return values;
}

async function main(args) {
  const values = argumentsOf(args);
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN is required");
  if (values["--relevant-issue"] !== undefined) {
    const relevant = await isRelevantIssue({
      request: (endpoint, options) => githubRequest(token, endpoint, options),
      repository: values["--repository"], parentNumber: Number(values["--issue"]),
      eventIssueNumber: Number(values["--relevant-issue"]),
      eventMilestoneNumber: values["--event-milestone"] === undefined
        ? undefined : Number(values["--event-milestone"])
    });
    process.stdout.write(`${relevant}\n`);
    return;
  }
  if (values["--event-milestone"] !== undefined) throw new Error("arguments are invalid");
  const result = await synchronizeReleasePlan({ request: (endpoint, options) => githubRequest(token, endpoint, options),
    repository: values["--repository"], issueNumber: Number(values["--issue"]) });
  process.stdout.write(`Release plan synchronized: ${result.complete ? "complete" : "open"}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((failure) => {
    process.stderr.write(`${failure instanceof Error ? failure.message : "Release plan synchronization failed"}\n`);
    process.exitCode = 1;
  });
}
