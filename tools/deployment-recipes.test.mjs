import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const YAML = createRequire(new URL("../frontend/package.json", import.meta.url))("yaml");
const deploy = fileURLToPath(new URL("../deploy/", import.meta.url));
const resolver = join(deploy, "recipe.sh");

const common = {
  COURTSIDE_VERSION: "0.1.0",
  COURTSIDE_SOURCE_URL: "https://example.org/courtside",
};
const bundledDatabase = { POSTGRES_PASSWORD: "placeholder" };
const caddy = { COURTSIDE_DOMAIN: "courts.example.org" };
const smtpRelay = {
  COURTSIDE_MAIL_RELAY_HOST: "smtp.example.org",
  COURTSIDE_MAIL_RELAY_USERNAME: "courts@example.org",
  COURTSIDE_MAIL_PASSWORD: "placeholder",
  COURTSIDE_MAIL_DOMAIN: "courts.example.org",
  COURTSIDE_MAIL_REPLY_TO: "board@example.org",
};
const stalwart = {
  COURTSIDE_MAIL_DOMAIN: "courts.example.org",
  COURTSIDE_MAIL_HOSTNAME: "mail.courts.example.org",
  COURTSIDE_MAIL_PASSWORD: "placeholder",
  COURTSIDE_MAIL_REPLY_TO: "board@example.org",
  COURTSIDE_MAIL_RELOAD_PASSWORD: "placeholder",
  COURTSIDE_MAIL_ADMIN_PASSWORD: "placeholder",
  COURTSIDE_MAIL_SETUP_PASSWORD: "placeholder",
  COURTSIDE_MAIL_DKIM_SELECTOR: "placeholder",
};
const externalDatabase = {
  COURTSIDE_DATABASE_URL: "jdbc:postgresql://database.example.org:5432/courtside",
  COURTSIDE_DATABASE_USERNAME: "courtside",
  COURTSIDE_DATABASE_PASSWORD: "placeholder",
};
const syntheticMail = {
  COURTSIDE_ACCEPTANCE_MAIL_CERTIFICATES: "/srv/courtside/acceptance-mail",
  COURTSIDE_ACCEPTANCE_MAIL_USER: "1000:1000",
};

const recipes = {
  standard: {
    files: ["compose.yaml", "compose.caddy.yaml", "compose.smtp-relay.yaml"],
    environment: { ...common, ...bundledDatabase, ...caddy, ...smtpRelay },
    services: { app: "", db: "", proxy: "" },
    required: "COURTSIDE_MAIL_RELAY_HOST",
  },
  "full-self-hosted": {
    files: ["compose.yaml", "compose.caddy.yaml", "compose.stalwart.yaml"],
    environment: { ...common, ...bundledDatabase, ...caddy, ...stalwart },
    services: { app: "", db: "", proxy: "", mail: "mail", "mail-certificate": "mail", "mail-reload": "mail",
      "mail-plan": "mail-setup", "mail-bootstrap": "mail-setup", "mail-configure": "mail-setup", "mail-check": "mail-check" },
    required: "COURTSIDE_MAIL_HOSTNAME",
  },
  "existing-infrastructure": {
    files: ["compose.yaml", "compose.external-database.yaml", "compose.smtp-relay.yaml"],
    environment: { ...common, ...externalDatabase, ...smtpRelay },
    services: { app: "" },
    required: "COURTSIDE_DATABASE_URL",
  },
  funnel: {
    files: ["compose.yaml", "compose.smtp-relay.yaml"],
    environment: { ...common, ...bundledDatabase, ...smtpRelay },
    services: { app: "", db: "" },
    required: "COURTSIDE_MAIL_DOMAIN",
  },
};

function resolve(args, script = resolver) {
  const result = spawnSync("bash", [script, ...args], { encoding: "utf8" });
  return { status: result.status, files: result.stdout.split("\n").filter(Boolean), error: result.stderr };
}

function resolved(...args) {
  const result = resolve(args);
  assert.equal(result.status, 0, `the resolver refused ${args.join(" ")}: ${result.error}`);
  return result.files;
}

function refused(args, pattern, script) {
  const result = resolve(args, script);
  assert.notEqual(result.status, 0, `the resolver accepted ${args.join(" ")}`);
  assert.deepEqual(result.files, [], `a refusal of ${args.join(" ")} still named files`);
  assert.match(result.error, pattern);
}

function render(files, environment) {
  const scratch = mkdtempSync(join(tmpdir(), "courtside-recipe-"));
  try {
    const envFile = join(scratch, "empty.env");
    writeFileSync(envFile, "");
    const result = spawnSync("docker", ["compose", "--project-directory", deploy, "--env-file", envFile,
      ...files.flatMap((file) => ["-f", join(deploy, file)]), "--profile", "*", "config", "--format", "json"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...environment },
    });
    return { status: result.status, model: result.status === 0 ? JSON.parse(result.stdout) : undefined,
      error: result.stderr };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function rendered(files, environment) {
  const result = render(files, environment);
  assert.equal(result.status, 0, `Compose refused ${files.join(" + ")}: ${result.error}`);
  return result.model;
}

function recipeCopy(recipeName, content) {
  const scratch = mkdtempSync(join(tmpdir(), "courtside-recipe-schema-"));
  mkdirSync(join(scratch, "recipes"));
  copyFileSync(resolver, join(scratch, "recipe.sh"));
  writeFileSync(join(scratch, "recipes", `${recipeName}.recipe`), content);
  return { script: join(scratch, "recipe.sh"), remove: () => rmSync(scratch, { recursive: true, force: true }) };
}

function manifest(key) {
  const compose = YAML.parse(readFileSync(join(deploy, "compose.yaml"), "utf8"));
  return compose[key];
}

test("given each declared recipe, when it is resolved, then it names its components in their merge order", () => {
  for (const [name, recipe] of Object.entries(recipes)) {
    // when
    const files = resolved("files", name);

    // then
    assert.deepEqual(files, recipe.files, `${name} resolved to another model`);
  }
});

test("given each declared recipe and only its own settings, when Compose renders it, then exactly its services exist",
  () => {
    for (const [name, recipe] of Object.entries(recipes)) {
      // given
      const files = resolved("files", name);

      // when
      const model = rendered(files, recipe.environment);

      // then
      assert.deepEqual(Object.fromEntries(Object.entries(model.services)
        .map(([service, definition]) => [service, (definition.profiles ?? []).join(",")])),
      Object.fromEntries(Object.entries(recipe.services).toSorted(([a], [b]) => a.localeCompare(b))),
      `${name} renders another set of services`);
    }
  });

test("given each declared recipe, when a setting its components require is missing, then Compose names it", () => {
  for (const [name, recipe] of Object.entries(recipes)) {
    // given
    const environment = { ...recipe.environment };
    delete environment[recipe.required];

    // when
    const result = render(resolved("files", name), environment);

    // then
    assert.notEqual(result.status, 0, `${name} rendered without ${recipe.required}`);
    assert.match(result.error, new RegExp(`required variable ${recipe.required} is missing`));
  }
});

test("given the standard recipe, when it is rendered, then nothing of the self-hosted mail server remains", () => {
  // given
  const model = rendered(resolved("files", "standard"), recipes.standard.environment);

  // when
  const text = JSON.stringify({ services: model.services, networks: model.networks, volumes: model.volumes });

  // then
  assert.doesNotMatch(text, /stalwart|mail-|relay"|sites\.d/);
  assert.equal(model.services.app.environment.COURTSIDE_MAIL_RELAY_HOST, "smtp.example.org");
  assert.equal(model.services.app.environment.COURTSIDE_MAIL_USERNAME, "courts@example.org");
  assert.equal(model.services.proxy.environment.COURTSIDE_MAIL_HOSTNAME, undefined);
});

test("given an external relay that admits this host, when no credentials are set, then the instance sends without signing in",
  () => {
    // given
    const environment = { ...recipes.funnel.environment };
    delete environment.COURTSIDE_MAIL_RELAY_USERNAME;
    delete environment.COURTSIDE_MAIL_PASSWORD;

    // when
    const model = rendered(resolved("files", "funnel"), environment);

    // then
    assert.equal(model.services.app.environment.COURTSIDE_MAIL_USERNAME, "");
    assert.equal(model.services.app.environment.COURTSIDE_MAIL_PASSWORD, "");
    assert.equal(model.services.app.environment.COURTSIDE_MAIL_RELAY_HOST, "smtp.example.org");
  });

test("given the existing-infrastructure recipe, when it is rendered, then the application reaches only the named database",
  () => {
    // given
    const model = rendered(resolved("files", "existing-infrastructure"), recipes["existing-infrastructure"].environment);

    // when
    const app = model.services.app;

    // then
    assert.equal(app.environment.SPRING_DATASOURCE_URL, externalDatabase.COURTSIDE_DATABASE_URL);
    assert.equal(app.environment.SPRING_DATASOURCE_USERNAME, externalDatabase.COURTSIDE_DATABASE_USERNAME);
    assert.equal(app.depends_on, undefined, "the application still waits for a database this recipe does not run");
    assert.equal(Object.keys(app.networks).includes("database"), false);
  });

test("given a recipe and hardening overlays, when they are named in any order, then one model results", () => {
  // when
  const forwards = resolved("files", "standard", "--overlay", "database-tls", "--overlay", "database-identities",
    "--overlay", "app-tls", "--overlay", "database-tls-local");
  const backwards = resolved("files", "standard", "--overlay", "database-tls-local", "--overlay", "app-tls",
    "--overlay", "database-identities", "--overlay", "database-tls");

  // then
  assert.deepEqual(forwards, [...recipes.standard.files, "compose.database-identities.yaml",
    "compose.database-tls.yaml", "compose.database-tls-local.yaml", "compose.app-tls.yaml"]);
  assert.deepEqual(backwards, forwards);
  assert.deepEqual(resolved("files", "existing-infrastructure", "--overlay", "database-tls"),
    [...recipes["existing-infrastructure"].files, "compose.database-tls.yaml"]);
});

test("given combinations no recipe can run, when they are resolved, then each is refused with its reason", () => {
  // given / when / then
  refused(["files", "funnel", "--overlay", "app-tls"], /app-tls needs the Caddy ingress/);
  refused(["files", "existing-infrastructure", "--overlay", "app-tls"], /app-tls needs the Caddy ingress/);
  refused(["files", "existing-infrastructure", "--overlay", "database-identities"],
    /database-identities needs the bundled database/);
  refused(["files", "existing-infrastructure", "--overlay", "database-tls", "--overlay", "database-tls-local"],
    /database-tls-local needs the bundled database/);
  refused(["files", "standard", "--overlay", "database-tls-local"], /database-tls-local needs database-tls/);
  refused(["files", "funnel", "--overlay", "database-tls"],
    /database-tls with the bundled database needs database-tls-local/);
  refused(["files", "standard", "--synthetic-mail", "--synthetic-mail"], /--synthetic-mail is named twice/);
  refused(["files", "full-self-hosted", "--synthetic-mail"], /synthetic mail replaces an external SMTP relay/);
  refused(["files", "standard", "--overlay", "database-tls", "--overlay", "database-tls"],
    /database-tls is named twice/);
  refused(["files", "standard", "--overlay", "compose.app-tls.yaml"], /unknown overlay/);
  refused(["files", "standard", "--overlay"], /--overlay needs a name/);
  refused(["files", "enterprise"], /unknown recipe enterprise/);
  refused(["files", "../recipes/standard"], /unknown recipe/);
  refused(["files"], /usage/);
  refused(["render", "standard"], /usage/);
  refused(["files", "standard", "--color"], /unknown option --color/);
});

test("given rootless Docker, when a recipe binds a privileged port, then only a host that permits the port may run it",
  () => {
    // given / when / then
    refused(["files", "standard", "--rootless-port-start", "1024"],
      /Caddy binds port 80, which rootless Docker cannot bind while unprivileged ports start at 1024/);
    refused(["files", "full-self-hosted", "--rootless-port-start", "80"],
      /Stalwart binds port 25, which rootless Docker cannot bind while unprivileged ports start at 80/);
    refused(["files", "standard", "--rootless-port-start", "eighty"], /--rootless-port-start needs a port number/);
    refused(["files", "standard", "--rootless-port-start"], /--rootless-port-start needs a port number/);
    refused(["files", "standard", "--rootless-port-start", "99999999999999999999"],
      /--rootless-port-start needs a port number/);
    refused(["files", "standard", "--rootless-port-start", "65536"], /--rootless-port-start needs a port number/);
    assert.deepEqual(resolved("files", "standard", "--rootless-port-start", "80"), recipes.standard.files);
    assert.deepEqual(resolved("files", "full-self-hosted", "--rootless-port-start", "0"),
      recipes["full-self-hosted"].files);
    assert.deepEqual(resolved("files", "funnel", "--rootless-port-start", "1024"), recipes.funnel.files);
    assert.deepEqual(resolved("files", "existing-infrastructure", "--rootless-port-start", "1024"),
      recipes["existing-infrastructure"].files);
  });

test("given a recipe file, when its schema is not the one this resolver reads, then it is refused rather than guessed",
  () => {
    const cases = [
      ["schema=2\ningress=caddy\ndatabase=bundled\nmail=smtp-relay\n", /schema 2, and this resolver reads schema 1/],
      ["ingress=caddy\ndatabase=bundled\nmail=smtp-relay\n", /declares no schema/],
      ["schema=1\ningress=caddy\ndatabase=bundled\nmail=smtp-relay\nimage=latest\n", /unknown key image/],
      ["schema=1\ningress=caddy\ningress=funnel\ndatabase=bundled\nmail=smtp-relay\n", /ingress is declared twice/],
      ["schema=1\ningress=caddy\ndatabase=bundled\n", /declares no mail/],
      ["schema=1\ningress=nginx\ndatabase=bundled\nmail=smtp-relay\n", /unknown ingress nginx/],
      ["schema=1\ningress=caddy\ndatabase=bundled\nmail=$(touch /tmp/courtside-recipe-sourced)\n", /line 4 is malformed/],
      ["schema=1\r\ningress=caddy\r\ndatabase=bundled\r\nmail=smtp-relay\r\n", /line 1 is malformed/],
      ["schema=1\ningress=funnel\ndatabase=bundled\nmail=stalwart\n", /runs Stalwart, which takes its certificate from the Caddy ingress/],
    ];
    for (const [content, pattern] of cases) {
      // given
      const copy = recipeCopy("fixture", content);
      try {
        // when / then
        refused(["files", "fixture"], pattern, copy.script);
      } finally {
        copy.remove();
      }
    }

    // given
    const current = recipeCopy("fixture", "# a comment\n\nschema=1\ningress=caddy\ndatabase=bundled\nmail=smtp-relay\n");
    try {
      // when
      const result = resolve(["files", "fixture"], current.script);

      // then
      assert.equal(result.status, 0, result.error);
      assert.deepEqual(result.files, recipes.standard.files);
    } finally {
      current.remove();
    }
  });

test("given acceptance with Mailpit, when it is rendered, then the instance can never call itself production", () => {
  // given
  const files = resolved("files", "standard", "--synthetic-mail");
  const environment = { ...recipes.standard.environment, ...syntheticMail, COURTSIDE_ENVIRONMENT: "PRODUCTION" };
  for (const key of ["COURTSIDE_MAIL_RELAY_HOST", "COURTSIDE_MAIL_RELAY_USERNAME", "COURTSIDE_MAIL_PASSWORD"]) {
    delete environment[key];
  }

  // when
  const model = rendered(files, environment);

  // then
  assert.deepEqual(files, ["compose.yaml", "compose.caddy.yaml", "compose.mailpit.yaml"]);
  assert.equal(model.services.app.environment.COURTSIDE_ENVIRONMENT, "UAT");
  assert.equal(model.services.app.environment.COURTSIDE_MAIL_RELAY_HOST, "mailpit");
  assert.match(model.services.mailpit.image, /^axllent\/mailpit:[^@]+@sha256:[a-f0-9]{64}$/);
  assert.deepEqual(resolved("files", "funnel", "--synthetic-mail"), ["compose.yaml", "compose.mailpit.yaml"]);
});

test("given acceptance with Mailpit, when it is rendered, then its messages are readable only from this host", () => {
  // given
  const model = rendered(resolved("files", "standard", "--synthetic-mail"), { ...recipes.standard.environment, ...syntheticMail });

  // when
  const mailpit = model.services.mailpit;
  const consoleNetworks = Object.keys(mailpit.networks).filter((network) => model.networks[network]?.internal !== true);

  // then
  assert.ok(mailpit.ports.length > 0, "Mailpit publishes no console, so this reads no binding");
  assert.deepEqual(mailpit.ports.map((port) => [port.host_ip, port.target]), [["127.0.0.1", 8025]]);
  assert.equal(model.networks["acceptance-mail"]?.internal, true);
  assert.ok(Object.keys(model.services.app.networks).includes("acceptance-mail"));
  assert.deepEqual(consoleNetworks, ["acceptance-mail-console"]);
  assert.deepEqual(Object.entries(model.services).filter(([name, service]) => name !== "mailpit"
    && Object.keys(service.networks ?? {}).includes("acceptance-mail-console")).map(([name]) => name), []);
});

test("given every recipe model, when a service publishes a port, then Docker has a network to publish it on", () => {
  const models = Object.entries(recipes).map(([name, recipe]) => [name, rendered(resolved("files", name), recipe.environment)]);
  models.push(["standard with synthetic mail", rendered(resolved("files", "standard", "--synthetic-mail"),
    { ...recipes.standard.environment, ...syntheticMail })]);
  for (const [name, model] of models) {
    // given
    const publishing = Object.entries(model.services).filter(([, service]) => (service.ports ?? []).length > 0);

    // when
    const unpublishable = publishing.filter(([, service]) => Object.keys(service.networks ?? {})
      .every((network) => model.networks[network]?.internal === true)).map(([service]) => service);

    // then
    assert.ok(publishing.length > 0, `${name} publishes nothing, so this reads no port`);
    assert.deepEqual(unpublishable, [], `${name} publishes a port only on internal networks, where Docker drops it`);
  }
});

test("given acceptance with Mailpit, when its root is read-only, then it still has somewhere to keep messages", () => {
  // given
  const model = rendered(resolved("files", "funnel", "--synthetic-mail"), { ...recipes.funnel.environment, ...syntheticMail });

  // when
  const mailpit = model.services.mailpit;

  // then
  assert.equal(mailpit.read_only, true);
  assert.ok((mailpit.tmpfs ?? []).includes("/tmp"), "Mailpit opens its message store under /tmp and exits without it");
});

test("given every recipe model, when its images are read, then each bundled component is pinned by digest", () => {
  for (const [name, recipe] of Object.entries(recipes)) {
    // given
    const model = rendered(resolved("files", name), recipe.environment);

    // when
    const images = Object.entries(model.services).filter(([service]) => service !== "app"
      && !service.startsWith("database-")).map(([, service]) => service.image);

    // then
    for (const image of images) {
      assert.match(image, /@sha256:[a-f0-9]{64}$/, `${name} runs ${image} by a tag that can move`);
    }
  }
});

test("given the component manifests, when the resolver's files are compared, then every selectable file is declared",
  () => {
    // given
    const production = manifest("x-courtside-production-overlays");
    const acceptance = manifest("x-courtside-acceptance-components");
    const selectable = new Set();
    for (const name of Object.keys(recipes)) resolved("files", name).forEach((f) => selectable.add(f));
    resolved("files", "existing-infrastructure", "--overlay", "database-tls").forEach((f) => selectable.add(f));
    resolved("files", "standard", "--overlay", "database-identities", "--overlay", "database-tls",
      "--overlay", "database-tls-local", "--overlay", "app-tls").forEach((f) => selectable.add(f));
    resolved("files", "standard", "--synthetic-mail").forEach((f) => selectable.add(f));

    // when
    const declared = new Set(["compose.yaml", ...production, ...acceptance]);

    // then
    assert.deepEqual([...selectable].toSorted(), [...declared].toSorted());
    assert.equal(production.includes("compose.mailpit.yaml"), false,
      "synthetic mail is declared as a production component");
  });
