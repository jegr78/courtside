import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync }
  from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { archiveEntries, buildArchive, emittedComposeFiles, executable, overlayNames, recipeNames,
  refuseSecrets } from "./deployment-archive.mjs";

const YAML = createRequire(new URL("../frontend/package.json", import.meta.url))("yaml");

const deploy = fileURLToPath(new URL("../deploy/", import.meta.url));
const release = {
  version: "0.1.0",
  revision: "0123456789abcdef0123456789abcdef01234567",
  image: "ghcr.io/jegr78/courtside@sha256:" + "a".repeat(64),
  repository: "jegr78/courtside",
  ref: "refs/tags/v0.1.0",
};

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

function composeText(root) {
  return emittedComposeFiles(root).map((file) => readFileSync(join(root, file), "utf8"));
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
    const spelledOut = [...Object.values(settings), ...composeText(root)];
    const rendered = new Set();
    for (const [recipe, chosen] of selections(root)) {
      // when
      const files = resolverOutput(root, [recipe, ...chosen]);
      const sources = boundSources(renderedFrom(root, files));
      files.forEach((file) => rendered.add(file));

      // then
      assert.ok(sources.length > 0, `${recipe} bound no file, so this proves nothing`);
      const outside = sources.filter((source) => !source.startsWith(`${root}/`));
      assert.deepEqual(outside.filter((source) => !spelledOut.some((text) => text.includes(source))), [],
        `${recipe} ${chosen.join(" ")} reaches outside the archive for a file nobody configured`);
      for (const source of sources.filter((source) => source.startsWith(`${root}/`))) {
        assert.ok(existsSync(source),
          `${recipe} ${chosen.join(" ")} binds ${relative(root, source)}, which the archive omits`);
      }
    }
    assert.deepEqual(emittedComposeFiles(root).filter((file) => !rendered.has(file)), [],
      "a Compose file the archive carries was never rendered");
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

test("given a release, when its archive is built, then the manifest it carries names the release, image, revision and signer", () => {
  // when
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

test("given an image no digest pins or a short revision, when the archive is built, then it is refused", () => {
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
  ["a certificate without a key", "tls.crt", "-----BEGIN CERTIFICATE-----\nPRIVATE KEY-----"],
  ["the environment template", ".env.example", "COURTSIDE_MAIL_PASSWORD="],
  ["a documented variable name", "README.md", "Set `POSTGRES_PASSWORD` in .env."],
  ["a variable naming a secret file", "x.yaml", "DB_OWNER_PASSWORD_FILE: /run/secrets/owner"],
  ["a path whose last segment is a word", "x.yaml", "- /run/secrets/owner-password:ro"],
  ["a setting that counts credentials", "x.env", "CREDENTIAL_ISSUE_MAX_PER_WINDOW=5"],
  ["a seed placeholder", "x.ndjson", '{"secret": "{{adminpassword}}"}'],
  ["a Stalwart environment macro", "x.json", '{"secret": "%{env:ADMIN_SECRET}%"}'],
  ["a structured value", "x.ndjson", '{"authSecret": {"@type": "None"}}'],
  ["a required reference in quotes", "x.sh", 'password="${MAIL_PASSWORD:?set it}"'],
  ["a plain shell reference", "x.sh", "password=$MAIL_PASSWORD"],
  ["a reference that falls back to another", "x.yaml", "PASSWORD: ${OUTER:-${INNER:?set it}}"],
  ["a value the shell computes", "x.sh", `credential="$(printf '%s' "$u:$p" | base64)"`],
  ["a Compose reset", "x.yaml", "POSTGRES_PASSWORD: !reset null"],
  ["a variable naming a key file", "x.yaml", "APP_TLS_KEY: /etc/courtside/tls/server.key"],
  ["a database URL without a password", "x.env", "URL=jdbc:postgresql://db.example.org:5432/x"],
  ["a sort key", "x.yaml", "sort_key: name"],
  ["a primary key", "x.yaml", "primary_key: id"],
  ["a word that ends in key", "x.yaml", "monkey: banana"],
  ["a public key", "x.yaml", "public_key: ssh-ed25519 AAAA"],
  ["a key algorithm", "x.env", "COURTSIDE_DKIM_KEY=rsa"],
  ["a shell command named like a secret", "x.sh", "  rotate_secret mail"],
  ["a Caddy directive that is not a secret", "Caddyfile", "\ttls_key internal"],
];

const refused = [
  ["a value in a Compose variable default", "compose.yaml", "PASSWORD: ${PASSWORD:-s3cret}"],
  ["a value in a nested default", "x.yaml", "PASSWORD: ${OTHER:-${NESTED:-s3cret}}"],
  ["a value Compose substitutes when set", "x.yaml", "PASSWORD: ${X:+s3cret}"],
  ["a literal after a reference", "x.yaml", "PASSWORD: ${A}hunter2"],
  ["an escaped dollar, which Compose ships literally", "x.env", "POSTGRES_PASSWORD=$$hunter2"],
  ["a value that begins with a slash", "x.yaml", "API_KEY: /s3cr3tAbc"],
  ["a value that begins with an exclamation mark", "x.yaml", "password: '!hunter2'"],
  ["a value in a flow sequence", "x.json", '{"API_TOKEN": ["abc123"]}'],
  ["a value in braces", "x.yaml", "password: {s3cret}"],
  ["a JSON key", "x.ndjson", '{"API_TOKEN": "abc123"}'],
  ["a camel-case key", "x.json", '{"passwordHash":"hunter2"}'],
  ["a dotted key", "x.properties", "spring.datasource.password=hunter2"],
  ["a hyphenated key", "x.yaml", "api-key: hunter2"],
  ["a plural name", "x.yaml", "API_KEYS: abc"],
  ["a space-separated directive", "Caddyfile", "api_token abc123"],
  ["a lowercase key", "x.yaml", "password: hunter2"],
  ["an RSA private key", "tls.key", "-----BEGIN RSA PRIVATE KEY-----"],
  ["a PGP private key", "x.asc", "-----BEGIN PGP PRIVATE KEY BLOCK-----"],
  ["an environment file somebody filled in", ".env", "POSTGRES_PASSWORD=hunter2"],
  ["a signing salt", "x.yaml", "COURTSIDE_SALT: 9f2c"],
  ["a credential inside a URL", "x.env", "URL=postgres://courtside:hunter2@db:5432/courtside"],
  ["a URL with a password and no user", "x.env", "URL=https://:hunter2@host/"],
  ["a URL password containing a slash", "x.env", "URL=https://user:p/ss@host/"],
];

function guarded(path, content) {
  return () => refuseSecrets([{ path, mode: 0o644, content: Buffer.from(`${content}\n`) }]);
}

test("given a file the archive may carry, when the credential guard reads it, then it stays", () => {
  for (const [what, path, content] of carried) {
    // when / then
    assert.doesNotThrow(guarded(path, content), `${what} was refused`);
  }
});

test("given a file that would publish a credential, when the guard reads it, then it is refused", () => {
  for (const [what, path, content] of refused) {
    // when / then
    assert.throws(guarded(path, content), (error) => error.message.startsWith(`${path} `),
      `${what} reached the archive`);
  }
});

function withCopy(change, use) {
  const scratchRoot = mkdtempSync(join(tmpdir(), "courtside-copy-"));
  try {
    const copy = join(scratchRoot, "deploy");
    cpSync(deploy, copy, { recursive: true });
    change(copy, scratchRoot);
    return use(copy);
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

function editComponent(copy, edit) {
  const component = join(copy, "compose.caddy.yaml");
  const model = YAML.parse(readFileSync(component, "utf8"), { logLevel: "silent" });
  edit(model, Object.values(model.services).find((service) => Array.isArray(service.volumes)));
  writeFileSync(component, YAML.stringify(model));
}

test("given a bind that climbs out of the deployment, when the archive is derived, then it is refused", () => {
  for (const source of ["./../secret.pem", "./../../secret.pem", "${EXTRA:-..}/secret.pem"]) {
    // given
    const climbing = (copy, outside) => {
      writeFileSync(join(outside, "secret.pem"), "material\n");
      editComponent(copy, (_, service) => service.volumes.push(`${source}:/x:ro`));
    };

    // when / then
    withCopy(climbing, (copy) => assert.throws(() => archiveEntries(copy), /climbs out of the deployment/,
      `${source} was not refused`));
  }
});

test("given a bind of the whole deployment, when the archive is derived, then it says so", () => {
  // given
  const whole = (copy) => editComponent(copy, (_, service) => service.volumes.push(".:/whole:ro"));

  // when / then
  withCopy(whole, (copy) => assert.throws(() => archiveEntries(copy), /binds the whole deployment directory/));
});

test("given a symlink out of the deployment, when the archive is derived, then it is refused", () => {
  // given
  const linked = (copy, outside) => {
    writeFileSync(join(outside, "secret.pem"), "material\n");
    rmSync(join(copy, "mail", "base.ndjson"));
    symlinkSync(join(outside, "secret.pem"), join(copy, "mail", "base.ndjson"));
  };

  // when / then
  withCopy(linked, (copy) => assert.throws(() => archiveEntries(copy), /outside the deployment/));
});

test("given every Compose key that names a neighbouring file, when the archive is derived, then it carries each", () => {
  // given
  const named = ["seed.env", "labels.env", "admin.secret", "site.conf", "seeds/one.sql", "extra/sub/a.txt"];
  const naming = (copy) => {
    for (const file of named) {
      mkdirSync(join(copy, file, ".."), { recursive: true });
      writeFileSync(join(copy, file), "placeholder\n");
    }
    editComponent(copy, (model, service) => {
      service.env_file = [{ path: "./seed.env" }];
      service.label_file = "labels.env";
      service.volumes.push("${EXTRA:-./extra}/sub:/extra:ro");
      model.secrets = { admin: { file: "admin.secret" }, inline: { environment: "ADMIN" } };
      model.configs = { site: { file: "./site.conf" }, greeting: { content: "hello" } };
      model.volumes = { seeds: { driver: "local", driver_opts: { type: "none", o: "bind", device: "./seeds" } } };
    });
  };

  // when
  const paths = withCopy(naming, (copy) => archiveEntries(copy).map((entry) => entry.path));

  // then
  assert.deepEqual(named.filter((file) => !paths.includes(file)), [],
    "a file a Compose key names is missing from the archive");
});

test("given a Compose key the derivation cannot follow, when the archive is derived, then it stops", () => {
  for (const key of ["extends", "build"]) {
    // given
    const unfollowable = (copy) => editComponent(copy, (_, service) => {
      service[key] = { file: "./other.yaml", context: "." };
    });

    // when / then
    withCopy(unfollowable, (copy) => assert.throws(() => archiveEntries(copy),
      new RegExp(`uses ${key}, which the archive cannot follow`)));
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
  const archive = workflow.slice(workflow.indexOf("\n  archive:"), workflow.indexOf("\n  qualify:"));
  const publish = workflow.slice(workflow.indexOf("\n  publish:"));

  // then
  assert.match(archive, /git status --porcelain --ignored -- deploy\//,
    "archive packs a deploy/ it never checked against the tagged commit");
  assert.match(publish, /name: deployment-archive/,
    "publish does not download the archive that was built once");
  assert.match(publish, /--output build\/rebuilt\n/, "publish does not rebuild the archive apart from it");
  assert.match(publish, /cmp "build\/courtside-deployment-\$version\.zip" "build\/rebuilt\/courtside-deployment-/,
    "publish does not compare the archive it publishes with one built from the tagged tree");
  assert.ok(publish.indexOf("cmp \"build/") < publish.indexOf("docker/login-action"),
    "the archive is compared only after the release has written to the registry");
  assert.match(publish, /files: \|[\s\S]*\n {12}build\/courtside-deployment-\*\n/,
    "the release page does not carry the archive that was downloaded");
  assert.match(publish, /attest-build-provenance[\s\S]*subject-path: build\/courtside-deployment-\*\.zip/,
    "the archive is published with a checksum and no provenance");
  assert.match(publish, /gh attestation verify "build\/courtside-deployment-/,
    "the archive's own attestation is created and never read back");
});
