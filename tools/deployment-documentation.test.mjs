import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function deploymentFile(name) {
  return readFileSync(fileURLToPath(new URL(`../deploy/${name}`, import.meta.url)), "utf8");
}

function repositoryFile(path) {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

// The verification profiles beside these two are not an operator surface, and documenting their
// variables would describe this repository's harness to a club.
const compose = ["compose.yaml", "compose.database-tls.yaml"].map(deploymentFile).join("\n");
const readme = deploymentFile("README.md");
const example = deploymentFile(".env.example");
const properties = repositoryFile("src/main/resources/application.yaml");
// A README wraps its lines, so a message quoted in a table may be split anywhere a space is.
const reflowed = readme.replace(/\s+/g, " ");
const scripts = {
  "mail-certificate.sh": deploymentFile("mail-certificate.sh"),
  "mail-reload.sh": deploymentFile("mail-reload.sh"),
};

function named(source, pattern) {
  return new Set([...source.matchAll(pattern)].map((match) => match[1]));
}

const PLACEHOLDER = "\u0000";

// A message reads `no certificate for $hostname in the proxy's store yet`, and the documentation
// writes the placeholder rather than a value, so what both sides share are the words around it.
function fragments(message) {
  return message
    .replace(/\$\([^)]*\)/g, PLACEHOLDER)
    .replace(/\$\{[^}]*\}/g, PLACEHOLDER)
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, PLACEHOLDER)
    .split(PLACEHOLDER)
    .filter((fragment) => fragment.length >= 8);
}

function announced(script) {
  return [...script.matchAll(/(?:announce|failed|healthy) "(.*)"/g)]
    .map((match) => match[1].replace(/^(?:failed|ok) /, ""));
}

test("given the reference deployment, when a variable is read, then it is documented and offered",
  () => {
    // given
    const interpolated = named(compose, /\$\{(COURTSIDE_[A-Z0-9_]+)/g);
    const documented = named(readme, /`(COURTSIDE_[A-Z0-9_]+)`/g);
    const offered = named(example, /^#?\s*(COURTSIDE_[A-Z0-9_]+)=/gm);

    // when / then
    assert.ok(interpolated.size > 40,
      `the operator-facing Compose files interpolate only ${interpolated.size} variables`);
    for (const variable of interpolated) {
      assert.ok(documented.has(variable),
        `Compose reads ${variable} and README.md never names it, so an operator can set it `
        + "only by reading the Compose file the documentation is supposed to replace");
      assert.ok(offered.has(variable),
        `Compose reads ${variable} and .env.example does not offer it`);
    }
    for (const variable of offered) {
      assert.ok(interpolated.has(variable),
        `.env.example offers ${variable} and no operator-facing Compose file reads it, so `
        + "setting it does nothing");
    }
    // The README says in one sentence which variables it still names after they stopped being read,
    // so the exemption is the documentation's own and not a list kept beside it.
    const retirement = readme.split("\n\n")
      .find((paragraph) => paragraph.includes("no longer read")) ?? "";
    const retired = named(retirement, /`(COURTSIDE_[A-Z0-9_]+)`/g);
    const read = named(properties, /\$\{(COURTSIDE_[A-Z0-9_]+)/g);
    for (const variable of documented) {
      assert.ok(interpolated.has(variable) || read.has(variable) || retired.has(variable),
        `README.md names ${variable} and neither Compose nor application.yaml reads it, so it `
        + "documents a variable that does nothing");
    }
  });

test("given a certificate container, when it announces a state, then the documentation explains it",
  () => {
    // given / when / then
    for (const [name, script] of Object.entries(scripts)) {
      const states = announced(script);
      assert.ok(states.length >= 8, `${name} announces only ${states.length} states`);
      for (const state of states) {
        for (const fragment of fragments(state)) {
          assert.ok(reflowed.includes(fragment.replace(/\s+/g, " ")),
            `${name} puts "${state}" into its health file and README.md explains no state saying `
            + `"${fragment}", so an unhealthy container names something nobody documented`);
        }
      }
    }
  });

test("given a documented command, when an operator runs it, then it prints no secret", () => {
  // given
  const commands = [...readme.matchAll(/```sh\n([\s\S]*?)```/g)].map((match) => match[1]);

  // when / then
  assert.ok(commands.length > 5, `README.md carries only ${commands.length} shell examples`);
  for (const command of commands) {
    assert.doesNotMatch(command, /tls\.key|PASSWORD/,
      `a documented command reads a key or a password out loud: ${command}`);
  }
});
