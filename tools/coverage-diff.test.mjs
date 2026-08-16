import assert from "node:assert/strict";
import test from "node:test";

import { parseChangedLines, parseJacoco, parseLcov, summarize } from "./coverage-diff.mjs";

test("given a zero-context diff, when parsing additions, then their new line numbers are retained", () => {
  const changed = parseChangedLines("+++ b/src/main/java/example/Decision.java\n@@ -4,0 +5,2 @@\n+first\n+second");

  assert.deepEqual([...changed.get("src/main/java/example/Decision.java")], [5, 6]);
});

test("given Java and frontend reports, when parsing coverage, then source paths and uncovered lines agree", () => {
  const java = parseJacoco('<package name="org/courtside/rules"><sourcefile name="Rule.java"><line nr="7" mi="1" ci="0" mb="1" cb="0"/></sourcefile></package>');
  const frontend = parseLcov("SF:src/auth/session.ts\nDA:4,1\nDA:5,0\nBRDA:4,0,0,1\nBRDA:4,0,1,-\nend_of_record\n");

  assert.equal(java.get("src/main/java/org/courtside/rules/Rule.java").lines.get(7), false);
  assert.deepEqual(java.get("src/main/java/org/courtside/rules/Rule.java").branches.get(7), { covered: 0, missed: 1 });
  assert.equal(frontend.get("frontend/src/auth/session.ts").lines.get(4), true);
  assert.equal(frontend.get("frontend/src/auth/session.ts").lines.get(5), false);
  assert.deepEqual(frontend.get("frontend/src/auth/session.ts").branches.get(4), { covered: 1, missed: 1 });
});

test("given changed critical decisions, when summarizing, then line and branch gaps are classified", () => {
  const changed = new Map([["src/main/java/org/courtside/rules/Rule.java", new Set([7, 8])]]);
  const coverage = new Map([["src/main/java/org/courtside/rules/Rule.java", {
    lines: new Map([[7, true]]), branches: new Map([[7, { covered: 1, missed: 1 }]])
  }]]);

  assert.deepEqual(summarize(changed, coverage, ["src/main/java/org/courtside/rules/"]), [{
    file: "src/main/java/org/courtside/rules/Rule.java",
    critical: true,
    executable: 1,
    uncovered: [],
    partialBranches: [{ line: 7, covered: 1, missed: 1 }],
    unmeasured: false
  }]);
});

test("given a changed source missing from coverage, when summarizing, then it is reported as unmeasured", () => {
  const changed = new Map([["src/main/java/org/courtside/identity/internal/NewGuard.java", new Set([1])]]);

  assert.deepEqual(summarize(changed, new Map(), ["src/main/java/org/courtside/identity/internal/"]), [{
    file: "src/main/java/org/courtside/identity/internal/NewGuard.java",
    critical: true,
    executable: 0,
    uncovered: [],
    partialBranches: [],
    unmeasured: true
  }]);
});
