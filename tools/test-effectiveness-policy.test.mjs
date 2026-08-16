import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pom = readFileSync(new URL("../pom.xml", import.meta.url), "utf8");
const frontendPackage = JSON.parse(readFileSync(new URL("../frontend/package.json", import.meta.url)));
const vite = readFileSync(new URL("../frontend/vite.config.ts", import.meta.url), "utf8");
const build = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");
const mutation = readFileSync(new URL("../.github/workflows/mutation-testing.yml", import.meta.url), "utf8");

test("given the required coverage evidence, when running verify, then backend and frontend reports are produced", () => {
  assert.match(pom, /jacoco-maven-plugin/);
  assert.match(pom, /<goal>prepare-agent<\/goal>/);
  assert.match(pom, /<goal>report<\/goal>/);
  assert.equal(frontendPackage.scripts.test.includes("--coverage"), true);
  assert.equal(frontendPackage.devDependencies["@vitest/coverage-v8"], frontendPackage.devDependencies.vitest);
  assert.match(vite, /provider: "v8"/);
  assert.match(build, /target\/site\/jacoco/);
  assert.match(build, /frontend\/coverage/);
});

test("given generated transport code, when reporting coverage, then it is not counted as hand-written decisions", () => {
  assert.match(pom, /org\/courtside\/api\/\*\*/);
  assert.match(vite, /src\/api\/schema\.d\.ts/);
});

test("given a pull request, when coverage is collected, then changed critical decisions receive context without a percentage gate", () => {
  assert.match(build, /tools\/coverage-diff\.mjs/);
  assert.doesNotMatch(pom, /<minimum>/);
  assert.doesNotMatch(vite, /thresholds:/);
});

test("given critical backend decisions, when the periodic mutation workflow runs, then mutation stays narrowly scoped", () => {
  assert.match(mutation, /workflow_dispatch:/);
  assert.match(mutation, /schedule:/);
  assert.match(mutation, /-Pmutation/);
  assert.match(pom, /pitest-maven/);
  assert.match(pom, /org\.courtside\.rules\.RuleEngine/);
  assert.match(pom, /org\.courtside\.shared\.TimeSlot/);
  assert.doesNotMatch(pom, /<targetClasses>[\s\S]*?<param>org\.courtside\.[^<]*\*[^<]*<\/param>/);
  assert.doesNotMatch(pom, /<targetTests>[\s\S]*?<param>org\.courtside\.[^<]*\*[^<]*<\/param>/);
});
