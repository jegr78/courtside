import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkDocumentation } from "./docs-check.mjs";

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
