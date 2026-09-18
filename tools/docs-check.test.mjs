import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkDocumentation } from "./docs-check.mjs";

test("given an image on a page, when checking it, then a missing file or a missing alt text fails closed", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-docs-image-"));
  mkdirSync(join(directory, "site"));
  mkdirSync(join(directory, "site", "screenshots"));
  writeFileSync(join(directory, "site", "screenshots", "court-plan.png"), "");
  const inventory = () => ["site/guide.md"];
  const page = (body) => writeFileSync(join(directory, "site", "guide.md"), `# Guide\n\n${body}\n`);

  try {
    // when / then
    page("![The week of a public court plan](screenshots/court-plan.png)");
    assert.doesNotThrow(() => checkDocumentation(directory, inventory));
    page("![The week of a public court plan](screenshots/missing.png)");
    assert.throws(() => checkDocumentation(directory, inventory), /does not exist/);
    page("![](screenshots/court-plan.png)");
    assert.throws(() => checkDocumentation(directory, inventory), /alt text/);
    page("![   ](screenshots/court-plan.png)");
    assert.throws(() => checkDocumentation(directory, inventory), /alt text/);
    page("![Reference style][plan]\n\n[plan]: screenshots/court-plan.png");
    assert.doesNotThrow(() => checkDocumentation(directory, inventory));
    page("![][plan]\n\n[plan]: screenshots/court-plan.png");
    assert.throws(() => checkDocumentation(directory, inventory), /alt text/);
    page("`![](screenshots/court-plan.png)`");
    assert.doesNotThrow(() => checkDocumentation(directory, inventory));
    page("[](screenshots/missing.png)");
    assert.throws(() => checkDocumentation(directory, inventory), /does not exist/);
    page("[][nowhere]");
    assert.throws(() => checkDocumentation(directory, inventory), /undefined link reference/);
    page("[][plan]\n\n[plan]: screenshots/court-plan.png");
    assert.doesNotThrow(() => checkDocumentation(directory, inventory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given a documentation tree, when checking it, then broken structure and references fail closed", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-docs-check-"));
  mkdirSync(join(directory, "docs"));
  writeFileSync(join(directory, "docs", "target.md"), "# Target heading\n");
  writeFileSync(join(directory, "docs", "quality-strategy.md"), "# Strategy\n");
  writeFileSync(join(directory, "README.md"), "# Readme\n\n[Target](docs/target.md#target-heading)\n");
  const inventory = () => ["README.md", "docs/quality-strategy.md", "docs/target.md"];

  try {
    // when / then
    assert.doesNotThrow(() => checkDocumentation(directory, inventory));
    writeFileSync(join(directory, "README.md"), "# Readme\n\n[Missing](docs/missing.md)\n");
    assert.throws(() => checkDocumentation(directory, inventory), /does not exist/);
    writeFileSync(join(directory, "README.md"), "# Readme\n\n[Missing][target]\n");
    assert.throws(() => checkDocumentation(directory, inventory), /undefined link reference/);
    writeFileSync(join(directory, "README.md"), "# Readme\n\n[Missing][target]\n\n[target]: docs/missing.md\n");
    assert.throws(() => checkDocumentation(directory, inventory), /does not exist/);
    writeFileSync(join(directory, "README.md"), "# Readme\n\n[Target][]\n\n[Target]: docs/target.md\n");
    assert.doesNotThrow(() => checkDocumentation(directory, inventory));
    writeFileSync(join(directory, "README.md"), "# Readme\n\n[Target]\n\n[Target]: docs/target.md\n");
    assert.doesNotThrow(() => checkDocumentation(directory, inventory));
    writeFileSync(join(directory, "README.md"), "# Readme\n\n`[Ignored](docs/missing.md)`\n\n~~~md\n[Ignored](docs/missing.md)\n~~~\n");
    assert.doesNotThrow(() => checkDocumentation(directory, inventory));
    writeFileSync(join(directory, "docs", "space name.md"), "# Spaced\n");
    const spacedInventory = () => [...inventory(), "docs/space name.md"];
    writeFileSync(join(directory, "README.md"), "# Readme\n\n[Spaced](<docs/space name.md>)\n");
    assert.doesNotThrow(() => checkDocumentation(directory, spacedInventory));
    writeFileSync(join(directory, "README.md"), "# Readme\n\n```text\nopen\n");
    assert.throws(() => checkDocumentation(directory, inventory), /fence/);
    writeFileSync(join(directory, "README.md"), "# Readme\n\n~~~text\nopen\n");
    assert.throws(() => checkDocumentation(directory, inventory), /fence/);
    writeFileSync(join(directory, "README.md"), "# Readme\n\n```js\n[Ignored](docs/missing.md)\n```not-a-close\n");
    assert.throws(() => checkDocumentation(directory, inventory), /fence/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given a published site download, when checking it, then the Courtside URL resolves to a public asset", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-docs-download-"));
  mkdirSync(join(directory, "site", "public", "examples"), { recursive: true });
  writeFileSync(join(directory, "site", "public", "examples", "members.csv"), "id;name\n1;Jane Doe\n");
  const inventory = () => ["site/guide.md"];
  const page = (target) => writeFileSync(join(directory, "site", "guide.md"),
    `# Guide\n\n[Download](${target})\n`);

  try {
    // when / then
    page("/examples/members.csv");
    assert.doesNotThrow(() => checkDocumentation(directory, inventory));
    page("/examples/missing.csv");
    assert.throws(() => checkDocumentation(directory, inventory), /does not exist/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given a published site download through a symbolic link, when checking it, then the link fails closed", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-docs-download-link-"));
  const examples = join(directory, "site", "public", "examples");
  const realAssets = join(directory, "site", "public", "real-assets");
  mkdirSync(examples, { recursive: true });
  mkdirSync(realAssets);
  writeFileSync(join(directory, "outside.csv"), "id;name\n1;Outside\n");
  writeFileSync(join(examples, "members.csv"), "id;name\n1;Jane Doe\n");
  writeFileSync(join(realAssets, "members.csv"), "id;name\n1;Jane Doe\n");
  symlinkSync(join(directory, "outside.csv"), join(examples, "outside.csv"));
  symlinkSync("members.csv", join(examples, "alias.csv"));
  symlinkSync(realAssets, join(examples, "linked-directory"));
  const inventory = () => ["site/guide.md"];
  const page = (target) => writeFileSync(join(directory, "site", "guide.md"),
    `# Guide\n\n[Download](${target})\n`);

  try {
    // when / then
    page("/examples/outside.csv");
    assert.throws(() => checkDocumentation(directory, inventory), /symbolic link/);
    page("/examples/alias.csv");
    assert.throws(() => checkDocumentation(directory, inventory), /symbolic link/);
    page("/examples/linked-directory/members.csv");
    assert.throws(() => checkDocumentation(directory, inventory), /symbolic link/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
