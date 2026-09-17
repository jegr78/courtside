import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertGeneratedHandbooks,
  generatedRecipeMarkdown,
  readRecipeCatalog,
} from "./deployment-handbook.mjs";

const repository = fileURLToPath(new URL("..", import.meta.url));
const deploy = join(repository, "deploy");

test("given the CLI recipe data, when the handbook is generated, then all four supported models share its commands", () => {
  // given
  const catalog = readRecipeCatalog(deploy);

  // when
  const english = generatedRecipeMarkdown(deploy, "en");
  const german = generatedRecipeMarkdown(deploy, "de");

  // then
  assert.deepEqual(catalog.map(({ name }) => name),
    ["existing-infrastructure", "full-self-hosted", "funnel", "standard"]);
  for (const recipe of catalog) {
    const command = `./recipe.sh files ${recipe.name}`;
    assert.match(english, new RegExp(command.replaceAll("-", "\\-")));
    assert.match(german, new RegExp(command.replaceAll("-", "\\-")));
    for (const file of recipe.files) {
      assert.ok(english.includes(file), `${recipe.name} omits ${file} from the English fragment`);
      assert.ok(german.includes(file), `${recipe.name} omits ${file} from the German fragment`);
    }
  }
});

test("given committed generated fragments, when recipe data changes, then the handbook check fails", () => {
  const scratch = mkdtempSync(join(tmpdir(), "courtside-handbook-"));
  try {
    // given
    const copied = join(scratch, "deploy");
    cpSync(deploy, copied, { recursive: true });
    writeFileSync(join(copied, "recipes", "standard.recipe"),
      readFileSync(join(copied, "recipes", "standard.recipe"), "utf8").replace("mail=smtp-relay", "mail=stalwart"));

    // when / then
    assert.throws(() => assertGeneratedHandbooks({
      deploy: copied,
      english: join(deploy, "guides", "generated-recipes.md"),
      german: join(repository, "site", "generated-operator-recipes.md"),
    }), /generated handbook.*out of date/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("given the operator documentation, when its entry points are read, then selection stays short and Funnel stays behind Caddy", () => {
  // given
  const readme = readFileSync(join(deploy, "README.md"), "utf8");
  const funnel = readFileSync(join(deploy, "guides", "funnel.md"), "utf8");
  const operations = readFileSync(join(deploy, "guides", "operations.md"), "utf8");
  const german = readFileSync(join(repository, "site", "operator-guide.md"), "utf8");

  // when / then
  assert.ok(readme.split("\n").length <= 180, "deploy/README.md is still the complete handbook");
  for (const guide of ["standard", "full-self-hosted", "existing-infrastructure", "funnel",
    "operations", "stalwart", "hardening"]) {
    assert.match(readme, new RegExp(`guides/${guide}\\.md`));
  }
  assert.match(funnel, /tailscale funnel --bg https\+insecure:\/\/127\.0\.0\.1:8080/);
  assert.match(operations, /tailscale funnel --bg https\+insecure:\/\/127\.0\.0\.1:\$\{COURTSIDE_PORT:-8080\}/);
  assert.match(funnel, /management/i);
  assert.match(funnel, /API/);
  assert.match(german, /tailscale funnel --bg https\+insecure:\/\/127\.0\.0\.1:8080/);
  assert.doesNotMatch(german, /\b(?:Sie|Ihr(?:e|en|em|er|es)?)\b/);
});
