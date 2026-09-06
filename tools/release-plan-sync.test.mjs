import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { isRelevantIssue, parseContract, releasePlanStatus, replaceStatus, statusEnd, statusStart,
  synchronizeReleasePlan } from "./release-plan-sync.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { parse } = require("yaml");
const contract = '<!-- courtside-release-plan-contract:{"release":"v0.1.0","children":[8,7],"statusComment":42} -->';
const body = `Plan\n${contract}\n`;
const statusBody = `${statusStart}\nold\n${statusEnd}\n`;

function issue(number, state = "open", total = 0, completed = 0) {
  return { number, state, title: `Issue ${number}`, body,
    sub_issues_summary: { total, completed }, milestone: { number: 5 } };
}

function response(status, payload = null) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null },
    json: async () => structuredClone(payload) };
}

function fixture({ parentState = "open", childStates = ["open", "closed"],
  childSummaries = [{ total: 0, completed: 0 }, { total: 0, completed: 0 }], milestoneOpen = 2,
  release = null } = {}) {
  const parent = issue(9, parentState);
  const children = [issue(8, childStates[0], childSummaries[0].total, childSummaries[0].completed),
    issue(7, childStates[1], childSummaries[1].total, childSummaries[1].completed)];
  const statusComment = { id: 42, issue_url: "https://api.github.com/repos/example/courtside/issues/9",
    body: statusBody };
  const milestone = { number: 5, title: "5 docs", open_issues: milestoneOpen, closed_issues: 4 };
  const writes = [];
  const request = async (endpoint, options = {}) => {
    if (options.method) {
      writes.push({ endpoint, ...options, payload: JSON.parse(options.body) });
      return response(200, {});
    }
    if (endpoint.endsWith("/issues/9")) return response(200, parent);
    if (endpoint.endsWith("/issues/comments/42")) return response(200, statusComment);
    if (endpoint.includes("/sub_issues")) return response(200, children);
    if (endpoint.endsWith("/milestones/5")) return response(200, milestone);
    if (endpoint.endsWith("/releases/tags/v0.1.0")) return release === null
      ? response(404) : response(200, release);
    return response(500);
  };
  return { request, writes };
}

test("given a contract, when parsed, then its release and ordered children are retained", () => {
  assert.deepEqual(parseContract(body), { release: "v0.1.0", children: [8, 7], statusComment: 42 });
  assert.throws(() => parseContract(body.replace("[8,7]", "[8,8]")), /duplicates/);
  assert.throws(() => parseContract(body.replace("v0.1.0", "latest")), /release is invalid/);
  assert.throws(() => parseContract(body.replace(contract, `${contract}\n${contract}`)), /duplicated/);
});

test("given marked status, when replaced, then surrounding plan text is unchanged", () => {
  assert.equal(replaceStatus(statusBody, "new\n"), `${statusStart}\nnew\n${statusEnd}\n`);
  assert.throws(() => replaceStatus(statusBody.replace(statusEnd, ""), "new\n"), /markers/);
});

test("given open work, when rendered, then work and release blockers remain visible", () => {
  const rendered = releasePlanStatus({ repository: "example/courtside", parent: issue(9),
    children: [issue(8, "open", 3, 2), issue(7, "closed")],
    milestone: { number: 5, title: "5 docs", open_issues: 2, closed_issues: 4 },
    releasePublished: false, synchronizedAt: new Date("2026-09-06T12:00:00Z") });
  assert.equal(rendered.complete, false);
  assert.equal(rendered.workComplete, false);
  assert.match(rendered.text, /Plan state: \*\*BLOCKED\*\*/);
  assert.match(rendered.text, /1\/2 closed/);
  assert.match(rendered.text, /2\/3 sub-issues closed/);
  assert.match(rendered.text, /v0\.1\.0: \*\*not published\*\*/);
  assert.match(releasePlanStatus({ repository: "example/courtside", parent: issue(9), children: [issue(8)],
    milestone: { number: 5, title: "5 · a club can look things up", open_issues: 2, closed_issues: 0 },
    releasePublished: false, synchronizedAt: new Date("2026-09-06T12:00:00Z") }).text,
  /5 · a club can look things up/);
});

test("given untrusted issue text, when rendered, then it cannot inject mentions or Markdown", () => {
  const child = issue(8);
  child.title = "@team [unsafe] `title`\nnext|\u202ehidden";
  const rendered = releasePlanStatus({ repository: "example/courtside", parent: issue(9), children: [child],
    milestone: { number: 5, title: "5 docs", open_issues: 2, closed_issues: 0 },
    releasePublished: false, synchronizedAt: new Date("2026-09-06T12:00:00Z") });
  assert.doesNotMatch(rendered.text, /@team|\[unsafe\]|`title`|\nnext|\||\u202e/);
});

test("given the plan is open, when synchronized, then only its generated comment is patched", async () => {
  const { request, writes } = fixture();
  const result = await synchronizeReleasePlan({ request, repository: "example/courtside", issueNumber: 9,
    synchronizedAt: new Date("2026-09-06T12:00:00Z") });
  assert.equal(result.reopened, false);
  assert.equal(writes.length, 1);
  assert.match(writes[0].endpoint, /issues\/comments\/42$/);
  assert.equal(writes[0].payload.state, undefined);
  assert.match(writes[0].payload.body, /Last successful synchronization/);
  assert.equal(writes[0].payload.body.includes(body), false);
});

test("given the contracted comment belongs to another issue, when synchronized, then no write occurs", async () => {
  const { request, writes } = fixture();
  const wrongIssue = async (endpoint, options) => {
    if (endpoint.endsWith("/issues/comments/42")) {
      return response(200, { id: 42,
        issue_url: "https://api.github.com/repos/example/courtside/issues/10", body: statusBody });
    }
    return request(endpoint, options);
  };
  await assert.rejects(synchronizeReleasePlan({ request: wrongIssue, repository: "example/courtside",
    issueNumber: 9 }), /status comment is invalid/);
  assert.deepEqual(writes, []);
});

test("given a closed plan has open work, when synchronized, then it is reopened with a reason", async () => {
  const { request, writes } = fixture({ parentState: "closed", milestoneOpen: 1 });
  const result = await synchronizeReleasePlan({ request, repository: "example/courtside", issueNumber: 9 });
  assert.equal(result.reopened, true);
  assert.equal(writes.length, 3);
  assert.match(writes[0].endpoint, /issues\/comments\/42$/);
  assert.deepEqual(writes[1].payload, { state: "open" });
  assert.match(writes[2].payload.body, /required work remains open/);
  assert.match(writes[2].payload.body, /v0\.1\.0 is not published/);
});

test("given all work and the stable release exist, when synced, then a closed plan stays closed", async () => {
  const published = { tag_name: "v0.1.0", draft: false, prerelease: false };
  const { request, writes } = fixture({ parentState: "closed", childStates: ["closed", "closed"],
    milestoneOpen: 0, release: published });
  const result = await synchronizeReleasePlan({ request, repository: "example/courtside", issueNumber: 9 });
  assert.equal(result.complete, true);
  assert.equal(result.reopened, false);
  assert.equal(writes.length, 1);
  assert.match(writes[0].endpoint, /issues\/comments\/42$/);
});

test("given a closed direct child has unfinished nested work, when synced, then the plan reopens", async () => {
  const published = { tag_name: "v0.1.0", draft: false, prerelease: false };
  const { request, writes } = fixture({ parentState: "closed", childStates: ["closed", "closed"],
    childSummaries: [{ total: 11, completed: 10 }, { total: 0, completed: 0 }],
    milestoneOpen: 0, release: published });
  const result = await synchronizeReleasePlan({ request, repository: "example/courtside", issueNumber: 9 });
  assert.equal(result.workComplete, false);
  assert.equal(result.reopened, true);
  assert.deepEqual(writes[1].payload, { state: "open" });
});

test("given an issue event, when checking scope, then only the plan, descendants and milestone are relevant", async () => {
  const parent = issue(9);
  const direct = issue(8);
  direct.milestone = null;
  const nested = issue(6);
  nested.milestone = null;
  const unrelated = issue(77);
  unrelated.milestone = null;
  const milestoneIssue = issue(88);
  const request = async (endpoint) => {
    if (endpoint.endsWith("/issues/9")) return response(200, parent);
    if (endpoint.endsWith("/issues/8")) return response(200, direct);
    if (endpoint.endsWith("/issues/6")) return response(200, nested);
    if (endpoint.endsWith("/issues/77")) return response(200, unrelated);
    if (endpoint.endsWith("/issues/88")) return response(200, milestoneIssue);
    if (endpoint.endsWith("/issues/8/parent")) return response(200, parent);
    if (endpoint.endsWith("/issues/6/parent")) return response(200, direct);
    if (endpoint.endsWith("/issues/77/parent")) return response(404);
    return response(500);
  };
  assert.equal(await isRelevantIssue({ request, repository: "example/courtside", parentNumber: 9,
    eventIssueNumber: 9 }), true);
  assert.equal(await isRelevantIssue({ request, repository: "example/courtside", parentNumber: 9,
    eventIssueNumber: 6 }), true);
  assert.equal(await isRelevantIssue({ request, repository: "example/courtside", parentNumber: 9,
    eventIssueNumber: 88 }), true);
  assert.equal(await isRelevantIssue({ request, repository: "example/courtside", parentNumber: 9,
    eventIssueNumber: 77, eventMilestoneNumber: 5 }), true);
  assert.equal(await isRelevantIssue({ request, repository: "example/courtside", parentNumber: 9,
    eventIssueNumber: 77 }), false);
});

test("given issue order differs from the contract, when synced, then it fails visibly", async () => {
  const { request } = fixture();
  const changed = async (endpoint, options) => endpoint.includes("/sub_issues")
    ? response(200, [issue(7, "closed"), issue(8, "closed")]) : request(endpoint, options);
  await assert.rejects(synchronizeReleasePlan({ request: changed, repository: "example/courtside", issueNumber: 9 }),
    /contract and sub-issue order differ/);
});

test("given more than one sub-issue page, when synced, then hidden scope cannot be ignored", async () => {
  const { request } = fixture();
  const paginated = async (endpoint, options) => {
    if (!endpoint.includes("/sub_issues")) return request(endpoint, options);
    const value = response(200, [issue(8), issue(7, "closed")]);
    value.headers.get = () => '<https://api.github.com/page/2>; rel="next"';
    return value;
  };
  await assert.rejects(synchronizeReleasePlan({ request: paginated, repository: "example/courtside", issueNumber: 9 }),
    /more sub-issues/);
});

test("given the workflow, when inspected, then it is bounded metadata work with no product build", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/release-plan-sync.yml", import.meta.url), "utf8"));
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.jobs.relevance.permissions, { contents: "read", issues: "read" });
  assert.equal(workflow.jobs.sync.needs, "relevance");
  assert.match(workflow.jobs.sync.if, /needs\.relevance\.outputs\.relevant == 'true'/);
  assert.match(JSON.stringify(workflow.jobs.relevance), /changes\.milestone\.from\.number/);
  assert.deepEqual(workflow.on.issues.types, ["closed", "edited", "milestoned", "demilestoned", "reopened"]);
  assert.deepEqual(workflow.on.release.types, ["published", "unpublished", "edited", "deleted"]);
  assert.match(workflow.jobs.relevance.if, /event_name != 'issues'.*github-actions\[bot\]/);
  const source = JSON.stringify(workflow);
  assert.match(source, /release-plan-sync\.mjs/);
  assert.doesNotMatch(source, /mvnw|npm (?:ci|test)|docker/);
  assert.equal(workflow.jobs.sync["timeout-minutes"], 5);
});
