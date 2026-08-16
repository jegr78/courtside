import assert from "node:assert/strict";
import test from "node:test";

import { parseChangedLines, parseJacoco, parseLcov, summarize } from "./coverage-diff.mjs";

test("given a zero-context diff, when parsing additions, then their new line numbers are retained", () => {
  const changed = parseChangedLines("+++ b/src/main/java/example/Decision.java\n@@ -4,0 +5,2 @@\n+first\n+second");

  assert.deepEqual([...changed.get("src/main/java/example/Decision.java")], [5, 6]);
});

test("given Java and frontend reports, when parsing coverage, then source paths and uncovered lines agree", () => {
  const java = parseJacoco('<package name="org/courtside/rules"><sourcefile name="Rule.java"><line nr="7" mi="1" ci="0" mb="1" cb="0"/></sourcefile></package>');
  const frontend = parseLcov("SF:/repo/frontend/src/auth/session.ts\nDA:4,1\nDA:5,0\nend_of_record\n");

  assert.equal(java.get("src/main/java/org/courtside/rules/Rule.java").get(7), false);
  assert.equal(frontend.get("frontend/src/auth/session.ts").get(4), true);
  assert.equal(frontend.get("frontend/src/auth/session.ts").get(5), false);
});

test("given changed critical decisions, when summarizing, then only executable changes are classified", () => {
  const changed = new Map([["src/main/java/org/courtside/rules/Rule.java", new Set([7, 8])]]);
  const coverage = new Map([["src/main/java/org/courtside/rules/Rule.java", new Map([[7, false]])]]);

  assert.deepEqual(summarize(changed, coverage, ["src/main/java/org/courtside/rules/"]), [{
    file: "src/main/java/org/courtside/rules/Rule.java",
    critical: true,
    executable: 1,
    uncovered: [7]
  }]);
});
