import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

function repositoryFile(path) {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

const design = repositoryFile("docs/design.md");
const risks = repositoryFile("docs/security-risks.md");
const instructions = repositoryFile("CLAUDE.md");
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function filesUnder(path) {
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      if ([".git", ".vitepress", "build", "dist", "node_modules", "superpowers", "target"]
        .includes(entry.name)) {
        continue;
      }
      files.push(...filesUnder(child));
    } else {
      files.push(child);
    }
  }
  return files;
}

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

test("given references to the design specification, when repository prose is checked, then none uses old section numbers",
  () => {
    // given
    const extensions = new Set([".java", ".json", ".md", ".mjs", ".yaml", ".yml"]);
    const roots = [".github", "deploy", "docs", "security", "site", "src", "tools"];
    const files = ["CLAUDE.md", "CONTRIBUTING.md", "README.md"]
      .map((path) => join(repositoryRoot, path)).concat(
        roots.flatMap((root) => filesUnder(join(repositoryRoot, root))));
    const numberedReference = /(?:section|§)\s*\d+.{0,200}(?:design specification|docs\/design\.md)|(?:design specification|docs\/design\.md).{0,200}(?:section|§)\s*\d+/i;

    // when
    const stale = files.filter((path) => extensions.has(extname(path)) || !extname(path))
      .filter((path) => numberedReference.test(readFileSync(path, "utf8").replaceAll(/\s+/g, " ")))
      .map((path) => relative(repositoryRoot, path));

    // then
    assert.deepEqual(stale, [], `numbered references to docs/design.md are stale: ${stale.join(", ")}`);
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
