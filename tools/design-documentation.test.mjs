import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function repositoryFile(path) {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

const design = repositoryFile("docs/design.md");
const risks = repositoryFile("docs/security-risks.md");
const instructions = repositoryFile("CLAUDE.md");

test("given the technical design, when its purpose is read, then it describes the current product", () => {
  // when / then
  assert.match(design, /\*\*Status:\*\* Current implementation contract/);
  assert.match(design, /It is not a roadmap\./);
  for (const source of ["openapi.yaml", "data-model.md", "authorization-policy.json",
    "production-architecture.json", "security-risks.md", "deploy/README.md"]) {
    assert.ok(design.includes(source), `docs/design.md does not identify ${source} as a detailed contract`);
  }
});

test("given ideas and historical planning language, when the design is checked, then it contains neither",
  () => {
    // given
    const obsoletePlanningLanguage = [
      /Approved for planning/i,
      /Release 1\b/i,
      /Designed, not built/i,
      /Open Questions?\b/i,
      /Candidate for a later release/i
    ];

    // when / then
    for (const phrase of obsoletePlanningLanguage) {
      assert.doesNotMatch(design, phrase,
        `docs/design.md contains roadmap or unresolved-decision language: ${phrase}`);
    }
  });

test("given future work and accepted limitations, when agents change the design, then their homes are explicit",
  () => {
    // when / then
    assert.match(instructions,
      /An unimplemented capability belongs in a concrete Product Backlog issue and not in\s+the specification/);
    assert.match(instructions,
      /An accepted security or privacy limitation is recorded in `docs\/security-risks\.md`/);
    assert.match(risks, /# Accepted security and privacy limitations/);
    assert.match(risks, /It is not a roadmap\. Product changes belong in issues\./);
  });
