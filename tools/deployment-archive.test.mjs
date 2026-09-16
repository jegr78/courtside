import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { archiveEntries, buildArchive, emittedComposeFiles, refuseSecrets } from "./deployment-archive.mjs";

const deploy = fileURLToPath(new URL("../deploy/", import.meta.url));
const release = {
  version: "0.1.0",
  revision: "0123456789abcdef0123456789abcdef01234567",
  image: "ghcr.io/jegr78/courtside@sha256:" + "a".repeat(64),
  repository: "jegr78/courtside",
  ref: "refs/tags/v0.1.0",
};

function executable(name) {
  const found = (process.env.PATH ?? "").split(delimiter).filter(isAbsolute)
    .map((directory) => join(directory, name)).find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`${name} is not on PATH, and this test needs it to read the archive`);
  return found;
}

function scratch(use) {
  const directory = mkdtempSync(join(tmpdir(), "courtside-archive-"));
  try {
    return use(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function extracted(zip, directory) {
  const file = join(directory, "archive.zip");
  writeFileSync(file, zip);
  const result = spawnSync(executable("unzip"), ["-q", file, "-d", directory], { encoding: "utf8" });
  assert.equal(result.status, 0, `an independent reader refused the archive: ${result.stderr}`);
  return join(directory, `courtside-deployment-${release.version}`);
}

function resolverOutput(root, args) {
  const result = spawnSync(executable("bash"), [join(root, "recipe.sh"), "files", ...args],
    { encoding: "utf8" });
  assert.equal(result.status, 0, `the shipped resolver refused ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.split("\n").filter(Boolean);
}

const recipes = ["standard", "full-self-hosted", "existing-infrastructure", "funnel"];

const settings = {
  COURTSIDE_VERSION: release.version,
  COURTSIDE_SOURCE_URL: "https://example.org/courtside",
  COURTSIDE_DOMAIN: "courts.example.org",
  POSTGRES_PASSWORD: "placeholder",
  COURTSIDE_MAIL_DOMAIN: "courts.example.org",
  COURTSIDE_MAIL_HOSTNAME: "mail.courts.example.org",
  COURTSIDE_MAIL_PASSWORD: "placeholder",
  COURTSIDE_MAIL_REPLY_TO: "board@example.org",
  COURTSIDE_MAIL_RELOAD_PASSWORD: "placeholder",
  COURTSIDE_MAIL_ADMIN_PASSWORD: "placeholder",
  COURTSIDE_MAIL_SETUP_PASSWORD: "placeholder",
  COURTSIDE_MAIL_DKIM_SELECTOR: "placeholder",
  COURTSIDE_MAIL_RELAY_HOST: "smtp.example.org",
  COURTSIDE_MAIL_RELAY_USERNAME: "courts@example.org",
  COURTSIDE_DATABASE_URL: "jdbc:postgresql://database.example.org:5432/courtside",
  COURTSIDE_DATABASE_USERNAME: "courtside",
  COURTSIDE_DATABASE_PASSWORD: "placeholder",
};

function renderedFrom(root, files) {
  const envFile = join(root, "empty.env");
  writeFileSync(envFile, "");
  const result = spawnSync(executable("docker"), ["compose", "--project-directory", root,
    "--env-file", envFile, ...files.flatMap((file) => ["-f", join(root, file)]),
    "--profile", "*", "config", "--format", "json"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...settings },
  });
  assert.equal(result.status, 0, `Compose refused ${files.join(" + ")} outside the source tree: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function boundSources(model) {
  return Object.values(model.services ?? {}).flatMap((service) => service.volumes ?? [])
    .filter((volume) => volume.type === "bind").map((volume) => volume.source);
}

test("given every recipe the archive ships, when each is resolved from an extracted copy, then the files it names are all in the archive", () => {
  const { zip } = buildArchive({ deploy, ...release });
  scratch((directory) => {
    const root = extracted(zip, directory);

    // when / then
    for (const recipe of recipes) {
      for (const file of resolverOutput(root, [recipe])) {
        assert.ok(existsSync(join(root, file)),
          `${recipe} names ${file}, and the archive does not carry it`);
      }
    }
  });
});

test("given the archive alone, when every recipe is rendered from it, then each bound file lies inside it", () => {
  const { zip } = buildArchive({ deploy, ...release });
  scratch((directory) => {
    const root = extracted(zip, directory);
    for (const recipe of recipes) {
      // when
      const sources = boundSources(renderedFrom(root, resolverOutput(root, [recipe])));

      // then
      assert.ok(sources.length > 0, `${recipe} bound no file, so this proves nothing`);
      assert.deepEqual(sources.filter((source) => !source.startsWith(`${root}/`)), [],
        `${recipe} reaches outside the archive for a file`);
      for (const source of sources) {
        assert.ok(existsSync(source),
          `${recipe} binds ${relative(root, source)} and the archive does not carry it`);
      }
    }
  });
});

test("given the same release, when the archive is built twice, then both runs produce one byte sequence", () => {
  // when
  const first = buildArchive({ deploy, ...release });
  const second = buildArchive({ deploy, ...release });

  // then
  assert.equal(first.sha256, second.sha256);
  assert.ok(first.zip.equals(second.zip), "two builds of one release produced different bytes");
});

test("given a built archive, when its manifest is read, then it names the release, image, revision and signer", () => {
  const { zip, manifest } = buildArchive({ deploy, ...release });

  // then
  assert.equal(manifest.version, release.version);
  assert.equal(manifest.revision, release.revision);
  assert.equal(manifest.image, release.image);
  assert.equal(manifest.signer,
    "https://github.com/jegr78/courtside/.github/workflows/release.yml@refs/tags/v0.1.0");
  scratch((directory) => {
    const root = extracted(zip, directory);
    const carried = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    assert.deepEqual(carried, manifest);
    for (const [path, digest] of Object.entries(manifest.files)) {
      assert.equal(createHash("sha256").update(readFileSync(join(root, path))).digest("hex"), digest,
        `the manifest records a different digest for ${path}`);
    }
  });
});

test("given an image that no digest pins, when the archive is built, then it is refused", () => {
  // when / then
  assert.throws(() => buildArchive({ deploy, ...release, image: "ghcr.io/jegr78/courtside:0.1.0" }),
    /digest/);
  assert.throws(() => buildArchive({ deploy, ...release, revision: "0123456" }), /revision/);
});

test("given the shipped deployment, when its files are read, then none carries a credential", () => {
  // when / then
  refuseSecrets(archiveEntries(deploy));
});

test("given a file that assigns a password, when the archive is built, then it is refused", () => {
  // when / then
  assert.throws(() => refuseSecrets([
    { path: "compose.yaml", mode: 0o644, content: Buffer.from("POSTGRES_PASSWORD: hunter2\n") },
  ]), /compose\.yaml/);
  assert.throws(() => refuseSecrets([
    { path: ".env", mode: 0o600, content: Buffer.from("") },
  ]), /\.env/);
});

test("given the shipped resolver, when every accepted combination is enumerated, then each named file exists", () => {
  // when
  const emitted = emittedComposeFiles(deploy);

  // then
  assert.ok(emitted.includes("compose.mailpit.yaml"),
    "the resolver can emit the synthetic mail file, so the archive has to carry it");
  assert.ok(!emitted.includes("compose.dev.yaml"), "a development file reached the archive");
  assert.ok(!emitted.includes("compose.security.yaml"), "an assessment file reached the archive");
  for (const file of emitted) assert.ok(existsSync(join(deploy, file)), `${file} does not exist`);
});

test("given an archive, when a shell script is extracted from it, then it is still executable", () => {
  const { zip } = buildArchive({ deploy, ...release });
  scratch((directory) => {
    const root = extracted(zip, directory);

    // then
    assert.ok(statSync(join(root, "recipe.sh")).mode & 0o111,
      "the resolver lost its executable bit, so a club cannot run it");
    assert.ok(!(statSync(join(root, "compose.yaml")).mode & 0o111),
      "a Compose file was shipped executable");
  });
});

test("given the release workflow, when it publishes, then it attaches the archive it already built", () => {
  const workflow = readFileSync(resolve(deploy, "../.github/workflows/release.yml"), "utf8");
  const publish = workflow.slice(workflow.indexOf("\n  publish:"));

  // then
  assert.match(publish, /name: deployment-archive/,
    "publish does not download the archive that was built once");
  assert.ok(!publish.includes("deployment-archive.mjs"),
    "publish builds the archive a second time instead of publishing the qualified bytes");
  assert.match(publish, /files: \|[\s\S]*build\/courtside-deployment-\*/,
    "the release page does not carry the archive");
  assert.match(publish, /attest-build-provenance[\s\S]*subject-path: build\/courtside-deployment-\*\.zip/,
    "the archive is published with a checksum and no provenance");
});
