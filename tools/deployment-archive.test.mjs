import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync }
  from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { archiveEntries, buildArchive, emittedComposeFiles, overlayNames, recipeNames, refuseSecrets }
  from "./deployment-archive.mjs";

const YAML = createRequire(new URL("../frontend/package.json", import.meta.url))("yaml");

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
    .map((directory) => join(directory, name))
    .find((candidate) => existsSync(candidate) && statSync(candidate).mode & 0o111);
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

const recipes = recipeNames(deploy);

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
  COURTSIDE_ACCEPTANCE_MAIL_CERTIFICATES: "/srv/courtside/acceptance-mail",
  COURTSIDE_ACCEPTANCE_MAIL_USER: "1000:1000",
  COURTSIDE_DB_TLS_AUTHORITY: "/srv/courtside/database-authority",
  COURTSIDE_DB_TLS_CERTIFICATE: "/srv/courtside/database-tls/server.crt",
  COURTSIDE_DB_TLS_KEY: "/srv/courtside/database-tls/server.key",
  COURTSIDE_DB_OWNER_USERNAME: "club_owner",
  COURTSIDE_DB_OWNER_PASSWORD_FILE: "/srv/courtside/database-owner-password",
  COURTSIDE_DB_MIGRATION_PASSWORD_FILE: "/srv/courtside/database-migration-password",
  COURTSIDE_DB_RUNTIME_PASSWORD_FILE: "/srv/courtside/database-runtime-password",
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

function selections(root) {
  const overlays = overlayNames(root);
  const chosen = [[], ["--synthetic-mail"],
    ...overlays.map((overlay) => ["--overlay", overlay]),
    overlays.flatMap((overlay) => ["--overlay", overlay])];
  return recipes.flatMap((recipe) => chosen.map((options) => [recipe, options]))
    .filter(([recipe, options]) => resolves(root, [recipe, ...options]));
}

function resolves(root, args) {
  return spawnSync(executable("bash"), [join(root, "recipe.sh"), "files", ...args]).status === 0;
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
    for (const [recipe, chosen] of selections(root)) {
      // when
      const sources = boundSources(renderedFrom(root, resolverOutput(root, [recipe, ...chosen])));

      // then
      assert.ok(sources.length > 0, `${recipe} bound no file, so this proves nothing`);
      // An absolute path elsewhere is the operator's; a sibling of the archive is the archive leaking.
      assert.deepEqual(sources.filter((source) => source.startsWith(directory)
        && !source.startsWith(`${root}/`)), [],
      `${recipe} ${chosen.join(" ")} reaches outside the archive for a file`);
      for (const source of sources.filter((source) => source.startsWith(`${root}/`))) {
        assert.ok(existsSync(source),
          `${recipe} ${chosen.join(" ")} binds ${relative(root, source)}, which the archive omits`);
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

const carried = [
  ["a certificate without a key", "tls.crt", "-----BEGIN CERTIFICATE-----\nPRIVATE KEY-----\n"],
  ["the environment template", ".env.example", "COURTSIDE_MAIL_PASSWORD=\n"],
  ["a documented variable name", "README.md", "Set `POSTGRES_PASSWORD` in .env.\n"],
  ["a variable naming a secret file", "x.yaml", "DB_OWNER_PASSWORD_FILE: /run/secrets/owner\n"],
  ["a path whose last segment is a word", "x.yaml", "- /run/secrets/owner-password:ro\n"],
  ["a setting that counts credentials", "x.env", "CREDENTIAL_ISSUE_MAX_PER_WINDOW=5\n"],
  ["a seed placeholder", "x.ndjson", '{"secret": "{{adminpassword}}"}\n'],
  ["a structured value", "x.ndjson", '{"authSecret": {"@type": "None"}}\n'],
  ["a shell reference in quotes", "x.sh", 'password="${MAIL_PASSWORD:?set it}"\n'],
  ["a variable naming a key file", "x.yaml", "APP_TLS_KEY: /etc/courtside/tls/server.key\n"],
  ["a database URL without a password", "x.env", "URL=jdbc:postgresql://db.example.org:5432/x\n"],
];

const refused = [
  ["a value in a Compose variable default", "compose.yaml", "PASSWORD: ${PASSWORD:-s3cret}\n"],
  ["a JSON key", "x.ndjson", '{"API_TOKEN": "abc123"}\n'],
  ["a space-separated directive", "Caddyfile", "api_token abc123\n"],
  ["a lowercase key", "x.yaml", "password: hunter2\n"],
  ["a private key", "tls.key", "-----BEGIN RSA PRIVATE KEY-----\n"],
  ["an environment file somebody filled in", ".env", "POSTGRES_PASSWORD=hunter2\n"],
  ["a signing salt", "x.yaml", "COURTSIDE_SALT: 9f2c\n"],
  ["a credential inside a URL", "x.env", "URL=postgres://courtside:hunter2@db:5432/courtside\n"],
];

test("given a file the archive may carry, when the credential guard reads it, then it stays", () => {
  for (const [what, path, content] of carried) {
    // when / then
    refuseSecrets([{ path, mode: 0o644, content: Buffer.from(content) }]);
    assert.ok(true, what);
  }
});

test("given a file that would publish a credential, when the guard reads it, then it is refused", () => {
  for (const [what, path, content] of refused) {
    // when / then
    assert.throws(() => refuseSecrets([{ path, mode: 0o644, content: Buffer.from(content) }]),
      new RegExp(path.replace(/[.]/g, "\\.")), `${what} reached the archive`);
  }
});

test("given a bind that climbs out of the deployment, when the archive is derived, then it is dropped", () => {
  const climbing = mkdtempSync(join(tmpdir(), "courtside-climb-"));
  try {
    // given
    writeFileSync(join(climbing, "secret.pem"), "material\n");
    const copy = join(climbing, "deploy");
    cpSync(deploy, copy, { recursive: true });
    writeFileSync(join(copy, "compose.caddy.yaml"),
      readFileSync(join(copy, "compose.caddy.yaml"), "utf8")
        .replace("- ./Caddyfile:", "- ./../secret.pem:/x:ro\n      - ./Caddyfile:"));

    // when
    const paths = archiveEntries(copy).map((entry) => entry.path);

    // then
    assert.ok(!paths.some((path) => path.endsWith("secret.pem")),
      "a bind that climbs out of the deployment put a file into the archive");
  } finally {
    rmSync(climbing, { recursive: true, force: true });
  }
});

test("given a symlink out of the deployment, when the archive is derived, then it is refused", () => {
  const linked = mkdtempSync(join(tmpdir(), "courtside-link-"));
  try {
    // given
    writeFileSync(join(linked, "secret.pem"), "material\n");
    const copy = join(linked, "deploy");
    cpSync(deploy, copy, { recursive: true });
    rmSync(join(copy, "mail", "base.ndjson"));
    symlinkSync(join(linked, "secret.pem"), join(copy, "mail", "base.ndjson"));

    // when / then
    assert.throws(() => archiveEntries(copy), /outside the deployment/);
  } finally {
    rmSync(linked, { recursive: true, force: true });
  }
});

test("given the archive, when a club follows its own first step, then the file that step names is in it", () => {
  // when
  const paths = archiveEntries(deploy).map((entry) => entry.path);

  // then
  assert.ok(paths.includes(".env.example"),
    "the guide says to copy .env.example, and the archive does not carry it");
});

test("given the overlays the deployment declares, when the archive is derived, then it carries each", () => {
  const model = YAML.parse(readFileSync(join(deploy, "compose.yaml"), "utf8"), { logLevel: "silent" });

  // when
  const emitted = emittedComposeFiles(deploy);

  // then
  const declared = model["x-courtside-production-overlays"];
  assert.ok(declared.length > 0, "compose.yaml declares no overlay, so this proves nothing");
  for (const file of declared) {
    assert.ok(emitted.includes(file), `${file} is a supported overlay the archive never derives`);
  }
  assert.deepEqual(overlayNames(deploy).filter((name) => !emitted.includes(`compose.${name}.yaml`)), [],
    "the resolver names an overlay whose file the archive does not carry");
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
  assert.match(publish, /jq -r \.revision <<< "\$manifest"\)" = "\$GITHUB_SHA"/,
    "nothing checks that the archive was packed from the commit its manifest claims");
  assert.match(publish, /jq -r \.image <<< "\$manifest"\)" = "\$IMAGE"/,
    "nothing checks that the archive names the digest this release publishes");
  assert.match(publish, /gh attestation verify "build\/courtside-deployment-/,
    "the archive's own attestation is created and never read back");
});
