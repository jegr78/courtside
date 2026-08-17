import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { requireBuiltAfterItsSources } from "./build-freshness";

function tree(name: string, file: string, secondsFromEpoch: number): string {
  const directory = mkdtempSync(resolve(tmpdir(), `courtside-${name}-`));
  mkdirSync(resolve(directory, "nested"), { recursive: true });
  const path = resolve(directory, "nested", file);
  writeFileSync(path, "x");
  utimesSync(path, secondsFromEpoch, secondsFromEpoch);
  return directory;
}

it("given a build newer than every source, when the suite checks it, then it starts", () => {
  // given
  const sources = tree("sources", "WeekView.tsx", 1_000);
  const artifact = tree("artifact", "index.js", 2_000);

  // when / then
  expect(() => requireBuiltAfterItsSources(artifact, sources, "npm run build")).not.toThrow();
});

it("given a packaged artifact rather than a directory, when the suite checks it, then its own age counts", () => {
  // given
  const sources = tree("sources", "RosterService.java", 1_000);
  const directory = mkdtempSync(resolve(tmpdir(), "courtside-jar-"));
  const jar = resolve(directory, "courtside-0.1.0.jar");
  writeFileSync(jar, "x");
  utimesSync(jar, 2_000, 2_000);

  // when / then
  expect(() => requireBuiltAfterItsSources(jar, sources, "./mvnw package")).not.toThrow();
});

it("given a source changed after the build, when the suite checks it, then it refuses and says how to fix it", () => {
  // given
  const sources = tree("sources", "WeekView.tsx", 2_000);
  const artifact = tree("artifact", "index.js", 1_000);

  // when / then
  expect(() => requireBuiltAfterItsSources(artifact, sources, "npm run build"))
    .toThrowError(/WeekView\.tsx.*Run 'npm run build'/s);
});
