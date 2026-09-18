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
  assert.match(funnel, /tailscale funnel --bg http:\/\/127\.0\.0\.1:8080/);
  assert.match(operations, /tailscale funnel --bg http:\/\/127\.0\.0\.1:\$\{COURTSIDE_PORT:-8080\}/);
  assert.match(operations, /\(cd \.\/nightly-deployment && sha256sum --check \*\.sha256\)/);
  assert.match(funnel, /management/i);
  assert.match(funnel, /API/);
  assert.match(german, /tailscale funnel --bg http:\/\/127\.0\.0\.1:8080/);
  assert.doesNotMatch(german, /\b(?:Sie|Ihr(?:e|en|em|er|es)?)\b/);
});

test("given synthetic mail certificates, when the acceptance guidance is read, then their path survives installation teardown safely", () => {
  // given
  const operations = readFileSync(join(deploy, "guides", "operations.md"), "utf8");
  const maintainedExamples = [
    readFileSync(join(deploy, ".env.example"), "utf8"),
    ...[
      "deployment-archive.test.mjs",
      "deployment-qualification.mjs",
      "deployment-recipes.test.mjs",
    ].map((file) => readFileSync(join(repository, "tools", file), "utf8")),
  ];

  // when / then
  for (const text of [operations, ...maintainedExamples]) {
    assert.match(text, /\/srv\/courtside-acceptance-mail/);
    assert.doesNotMatch(text, /\/srv\/courtside\/acceptance-mail/);
  }
  assert.match(operations, /mode 0700/);
  assert.match(operations, /mode 0600/);
  assert.match(operations, /remove it explicitly after the\s+synthetic acceptance deployment/i);
});
