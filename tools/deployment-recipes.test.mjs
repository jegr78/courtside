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
  COURTSIDE_IMAGE_DIGEST: "a".repeat(64),
  COURTSIDE_SOURCE_URL: "https://example.org/courtside",
};
const customImage = {
  COURTSIDE_CUSTOM_IMAGE_REPOSITORY: "registry.example.org/example/courtside",
  COURTSIDE_CUSTOM_IMAGE_DIGEST: "b".repeat(64),
  COURTSIDE_SOURCE_URL: "https://example.org/example/courtside",
};
const customImageReference = `${customImage.COURTSIDE_CUSTOM_IMAGE_REPOSITORY}`
  + `@sha256:${customImage.COURTSIDE_CUSTOM_IMAGE_DIGEST}`;
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
const databaseTls = {
  COURTSIDE_DB_TLS_AUTHORITY: "/srv/courtside/database-authority",
  COURTSIDE_DB_TLS_CERTIFICATE: "/srv/courtside/database-tls/server.crt",
  COURTSIDE_DB_TLS_KEY: "/srv/courtside/database-tls/server.key",
};
const externalOwner = { COURTSIDE_DB_OWNER_USERNAME: "club_owner" };
const separateIdentities = {
  COURTSIDE_DB_OWNER_PASSWORD_FILE: "/srv/courtside/database-owner-password",
  COURTSIDE_DB_MIGRATION_PASSWORD_FILE: "/srv/courtside/database-migration-password",
  COURTSIDE_DB_RUNTIME_PASSWORD_FILE: "/srv/courtside/database-runtime-password",
};
const syntheticMail = {
  COURTSIDE_ACCEPTANCE_MAIL_CERTIFICATES: "/srv/courtside/acceptance-mail",
  COURTSIDE_ACCEPTANCE_MAIL_USER: "1000:1000",
};

const recipes = {
  standard: {
    files: ["compose.yaml", "compose.caddy.yaml", "compose.caddy-public.yaml", "compose.smtp-relay.yaml"],
    environment: { ...common, ...bundledDatabase, ...caddy, ...smtpRelay },
    services: { app: "", db: "", proxy: "" },
    required: "COURTSIDE_MAIL_RELAY_HOST",
  },
  "full-self-hosted": {
    files: ["compose.yaml", "compose.caddy.yaml", "compose.caddy-public.yaml", "compose.stalwart.yaml"],
    environment: { ...common, ...bundledDatabase, ...caddy, ...stalwart },
    services: { app: "", db: "", proxy: "", mail: "mail", "mail-certificate": "mail", "mail-reload": "mail",
      "mail-plan": "mail-setup", "mail-bootstrap": "mail-setup", "mail-configure": "mail-setup", "mail-check": "mail-check" },
    required: "COURTSIDE_MAIL_HOSTNAME",
  },
  "existing-infrastructure": {
    files: ["compose.yaml", "compose.external-database.yaml", "compose.caddy.yaml",
      "compose.caddy-forwarded.yaml", "compose.smtp-relay.yaml"],
    environment: { ...common, ...externalDatabase, ...caddy, ...smtpRelay },
    services: { app: "", proxy: "" },
    required: "COURTSIDE_DATABASE_URL",
  },
  funnel: {
    files: ["compose.yaml", "compose.caddy.yaml", "compose.caddy-forwarded.yaml", "compose.smtp-relay.yaml"],
    environment: { ...common, ...bundledDatabase, ...caddy, ...smtpRelay },
    services: { app: "", db: "", proxy: "" },
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

function everyChain() {
  const overlays = ["database-identities", "database-tls", "database-tls-local", "app-tls"];
  const chains = [];
  for (const name of Object.keys(recipes)) {
    for (const mail of [[], ["--synthetic-mail"]]) {
      for (let selection = 0; selection < 1 << overlays.length; selection += 1) {
        const selected = overlays.filter((overlay, position) => selection & (1 << position))
          .flatMap((overlay) => ["--overlay", overlay]);
        const result = resolve(["files", name, ...selected, ...mail]);
        if (result.status === 0) chains.push(result.files);
      }
    }
  }
  return chains;
}

function environmentUse(file) {
  const model = YAML.parse(readFileSync(join(deploy, file), "utf8")
    .replace(/!reset\s+(?:null|\{\}|\[\])/g, '"resets this"').replace(/!override\b/g, ""));
  const writes = new Set();
  const resets = new Set();
  for (const [service, definition] of Object.entries(model?.services ?? {})) {
    const environment = definition?.environment;
    if (environment === null || typeof environment !== "object" || Array.isArray(environment)) continue;
    writes.add(service);
    if (Object.values(environment).includes("resets this")) resets.add(service);
  }
  return { writes, resets };
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

test("given every supported ingress, when its model is rendered, then Caddy is the only host web boundary", () => {
  for (const [name, recipe] of Object.entries(recipes)) {
    // given
    const model = rendered(resolved("files", name), recipe.environment);

    // when
    const app = model.services.app;
    const proxy = model.services.proxy;
    const published = proxy.ports ?? [];

    // then
    assert.ok(proxy, `${name} has no Courtside-managed proxy`);
    assert.equal(app.ports, undefined, `${name} publishes the application port`);
    assert.ok(Object.hasOwn(app.networks, "ingress"), `${name} does not connect the application to Caddy`);
    if (name === "standard" || name === "full-self-hosted") {
      assert.deepEqual(published.map((port) => port.published).toSorted(), ["443", "80"]);
    } else {
      assert.deepEqual(published.map((port) => [port.host_ip, port.published, port.target]),
        [["127.0.0.1", "8080", 8080]], `${name} does not keep its Caddy listener on loopback`);
      assert.equal(proxy.environment.COURTSIDE_INGRESS_MODE, "forwardedIngress",
        `${name} does not require proof of outer HTTPS`);
    }
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

test("given every supported ingress, when its public hostname is missing, then the recipe refuses to render", () => {
  for (const [name, recipe] of Object.entries(recipes)) {
    // given
    const environment = { ...recipe.environment };
    delete environment.COURTSIDE_DOMAIN;

    // when
    const result = render(resolved("files", name), environment);

    // then
    assert.notEqual(result.status, 0, `${name} rendered without COURTSIDE_DOMAIN`);
    assert.match(result.error, /required variable COURTSIDE_DOMAIN is missing/);
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

test("given separate identities on an external database, when the recipe is rendered, then each process holds its own credential",
  () => {
    // given
    const files = resolved("files", "existing-infrastructure", "--overlay", "database-identities");

    // when
    const environment = { ...common, ...caddy, COURTSIDE_DATABASE_URL: externalDatabase.COURTSIDE_DATABASE_URL,
      ...separateIdentities, ...smtpRelay };
    const model = rendered(files, { ...environment, ...externalOwner });
    const { app, "database-setup": setup, "database-migrate": migrate } = model.services;

    // then
    assert.equal(files.includes("compose.external-database.yaml"), false,
      "the shared credential the separated identities replace is still demanded");
    assert.equal(model.services.db, undefined, "the recipe still runs a database of its own");
    assert.equal(Object.keys(model.networks ?? {}).includes("database"), false);
    for (const [name, process] of Object.entries({ app, setup, migrate })) {
      assert.equal(process.environment.SPRING_DATASOURCE_URL, externalDatabase.COURTSIDE_DATABASE_URL,
        `${name} reads another database`);
      assert.equal(Object.keys(process.networks ?? {}).includes("database"), false,
        `${name} still joins the network only the bundled database has`);
    }
    for (const process of [setup, migrate]) {
      assert.deepEqual(Object.keys(process.networks), ["database-egress"]);
    }
    assert.match(render(files, environment).error,
      /required variable COURTSIDE_DB_OWNER_USERNAME is missing/,
      "the default owner role name is accepted, and no provider hands that name out");
    const plain = rendered(resolved("files", "existing-infrastructure"),
      { ...common, ...caddy, ...externalDatabase, ...smtpRelay });
    assert.deepEqual(Object.keys(app.networks), Object.keys(plain.services.app.networks),
      "the overlay changed which networks the application joins, and it has no reason to");
    const egressMembers = (rendering) => Object.entries(rendering.services)
      .filter(([, process]) => Object.keys(process.networks ?? {}).includes("database-egress"))
      .map(([name]) => name).sort();
    assert.deepEqual(egressMembers(model), ["database-migrate", "database-setup"],
      "the guide promises that nothing else joins the egress network");
    const synthetic = rendered(
      resolved("files", "existing-infrastructure", "--overlay", "database-identities", "--synthetic-mail"),
      { ...environment, ...externalOwner, ...syntheticMail });
    assert.deepEqual(egressMembers(synthetic), ["database-migrate", "database-setup"],
      "another overlay reached the egress network reserved for the two one-shot processes");
    assert.equal(setup.depends_on, undefined, "setup still waits for a database this recipe does not run");
    assert.equal(migrate.depends_on["database-setup"].condition, "service_completed_successfully");
    assert.equal(app.depends_on["database-migrate"].condition, "service_completed_successfully");
    assert.equal(app.environment.COURTSIDE_DB_IDENTITY_MODE, "separate");
    assert.equal(app.environment.SPRING_DATASOURCE_USERNAME, undefined);
    assert.equal(app.environment.SPRING_DATASOURCE_PASSWORD, undefined);
    assert.equal(setup.environment.COURTSIDE_DB_OWNER_PASSWORD_FILE, "/run/secrets/database-owner-password");
  });

test("given a recipe and the identity overlay, when it is rendered, then no shared credential survives for the application",
  () => {
    let covered = 0;
    for (const [name, recipe] of Object.entries(recipes)) {
      const bundled = !recipe.files.includes("compose.external-database.yaml");
      const hardened = ["database-identities", "database-tls"];
      if (bundled) hardened.push("database-tls-local");
      if (recipe.files.includes("compose.caddy.yaml")) hardened.push("app-tls");

      for (const overlays of [["database-identities"], hardened]) {
        covered += 1;
        // given
        const files = resolved("files", name, ...overlays.flatMap((overlay) => ["--overlay", overlay]));

        // when
        const app = rendered(files, { ...recipe.environment, ...separateIdentities, ...externalOwner,
          ...databaseTls }).services.app;

        // then
        assert.equal(app.environment.COURTSIDE_DB_IDENTITY_MODE, "separate");
        for (const credential of ["SPRING_DATASOURCE_USERNAME", "SPRING_DATASOURCE_PASSWORD"]) {
          assert.equal(app.environment[credential], undefined,
            `${name} with ${overlays.join(" and ")} hands the application ${credential}, `
            + "which the separate identity refuses to start beside");
        }
      }
    }
    assert.ok(covered > 0, "no recipe reached the identity overlay, so this read nothing");
  });

test("given the identity and database TLS overlays, when they are combined, then only the application is held to verify-full",
  () => {
    // given
    const chains = {
      funnel: {
        files: resolved("files", "funnel", "--overlay", "database-identities", "--overlay", "database-tls",
          "--overlay", "database-tls-local"),
        environment: { ...recipes.funnel.environment, ...separateIdentities, ...databaseTls },
      },
      "existing-infrastructure": {
        files: resolved("files", "existing-infrastructure", "--overlay", "database-identities",
          "--overlay", "database-tls"),
        environment: { ...common, ...caddy, COURTSIDE_DATABASE_URL: externalDatabase.COURTSIDE_DATABASE_URL,
          ...separateIdentities, ...externalOwner, ...databaseTls, ...smtpRelay },
      },
    };

    for (const [recipe, chain] of Object.entries(chains)) {
      // when
      const model = rendered(chain.files, chain.environment);
      const hardened = rendered(chain.files, { ...chain.environment, COURTSIDE_DB_TLS_MODE: "verify-full" });

      // then
      for (const process of ["database-setup", "database-migrate"]) {
        assert.equal(model.services[process].environment.COURTSIDE_DB_TLS_MODE, "prefer",
          `${recipe}: ${process} would verify the certificate without the operator asking`);
        assert.equal(hardened.services[process].environment.COURTSIDE_DB_TLS_MODE, "verify-full",
          `${recipe}: ${process} ignores the policy the guide tells an operator to set`);
        assert.equal(model.services[process].environment.COURTSIDE_DB_TLS_ROOT_CERTIFICATE,
          model.services.app.environment.COURTSIDE_DB_TLS_ROOT_CERTIFICATE);
      }
      assert.equal(model.services.app.environment.COURTSIDE_DB_TLS_MODE, "verify-full");
    }
  });

test("given every resolvable chain, when a component resets an environment value, then no earlier component wrote it",
  () => {
    // given
    let covered = 0;

    for (const chain of everyChain()) {
      // when
      const components = chain.map(environmentUse);

      // then
      for (const [position, { resets }] of components.entries()) {
        for (const service of resets) {
          covered += 1;
          const written = components.slice(1, position).findIndex((component) => component.writes.has(service));
          assert.equal(written, -1, `${chain[position]} resets an environment value of ${service}, which `
            + `${chain[written + 1]} has already written, so Compose keeps the value`);
        }
      }
    }
    assert.ok(covered > 0, "no component in any chain resets an environment value");
  });

test("given a recipe and hardening overlays, when they are named in any order, then one model results", () => {
  // when
  const forwards = resolved("files", "standard", "--overlay", "database-tls", "--overlay", "database-identities",
    "--overlay", "custom-image", "--overlay", "app-tls", "--overlay", "database-tls-local");
  const backwards = resolved("files", "standard", "--overlay", "database-tls-local", "--overlay", "app-tls",
    "--overlay", "custom-image", "--overlay", "database-identities", "--overlay", "database-tls");

  // then
  const [base, ...components] = recipes.standard.files;
  assert.deepEqual(forwards, [base, "compose.database-identities.yaml", ...components,
    "compose.database-tls.yaml", "compose.database-tls-local.yaml", "compose.app-tls.yaml",
    "compose.database-identities-custom-image.yaml", "compose.custom-image.yaml"]);
  assert.deepEqual(backwards, forwards);
  assert.deepEqual(resolved("files", "existing-infrastructure", "--overlay", "database-tls"),
    [...recipes["existing-infrastructure"].files, "compose.database-tls.yaml"]);
  const [externalBase, external, ...externalComponents] = recipes["existing-infrastructure"].files;
  assert.equal(external, "compose.external-database.yaml");
  assert.deepEqual(resolved("files", "existing-infrastructure", "--overlay", "database-identities",
    "--overlay", "database-tls"),
  [externalBase, "compose.database-identities.yaml", ...externalComponents, "compose.database-tls.yaml",
    "compose.external-database-identities.yaml"],
  "the separated overlay has to stay last, or its resets no longer reach what the chain already set");
});

test("given combinations no recipe can run, when they are resolved, then each is refused with its reason", () => {
  // given / when / then
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

test("given a forwarded ingress, when application TLS is selected, then Caddy still owns that hop", () => {
  // when
  const funnel = resolved("files", "funnel", "--overlay", "app-tls");
  const external = resolved("files", "existing-infrastructure", "--overlay", "app-tls");

  // then
  assert.deepEqual(funnel, [...recipes.funnel.files, "compose.app-tls.yaml"]);
  assert.deepEqual(external, [...recipes["existing-infrastructure"].files, "compose.app-tls.yaml"]);
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
  assert.deepEqual(files,
    ["compose.yaml", "compose.caddy.yaml", "compose.caddy-public.yaml", "compose.mailpit.yaml"]);
  assert.equal(model.services.app.environment.COURTSIDE_ENVIRONMENT, "UAT");
  assert.equal(model.services.app.environment.COURTSIDE_MAIL_RELAY_HOST, "mailpit");
  assert.match(model.services.mailpit.image, /^axllent\/mailpit:[^@]+@sha256:[a-f0-9]{64}$/);
  assert.deepEqual(resolved("files", "funnel", "--synthetic-mail"),
    ["compose.yaml", "compose.caddy.yaml", "compose.caddy-forwarded.yaml", "compose.mailpit.yaml"]);
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
    const images = Object.values(model.services).map((service) => service.image).filter(Boolean);

    // then
    for (const image of images) {
      assert.match(image, /@sha256:[a-f0-9]{64}$/, `${name} runs ${image} by a tag that can move`);
    }
  }
});

test("given a custom image mode, when each recipe is rendered, then every Courtside process uses that source", () => {
  for (const [name, recipe] of Object.entries(recipes)) {
    // given
    const identity = ["--overlay", "database-identities"];
    const options = ["--overlay", "custom-image", ...identity];
    const environment = { ...recipe.environment, ...customImage, ...separateIdentities, ...externalOwner };

    // when
    const selected = resolve(["files", name, ...options]);
    const model = rendered(selected.files, environment);
    const processes = [model.services.app, model.services["database-setup"], model.services["database-migrate"]];

    // then
    assert.equal(selected.status, 0, selected.error);
    assert.match(selected.error, /custom image has no Courtside release trust guarantee/);
    for (const process of processes) assert.equal(process.image, customImageReference);
    assert.equal(model.services.app.environment.COURTSIDE_SOURCE_URL, customImage.COURTSIDE_SOURCE_URL);
    assert.equal(model.services.app.labels["org.courtside.image-trust"], "custom");
  }
});

test("given custom image mode, when its repository, digest or source is missing, then Compose names the decision", () => {
  // given
  const files = resolved("files", "standard", "--overlay", "custom-image");

  // when / then
  assert.match(render(files, recipes.standard.environment).error,
    /required variable COURTSIDE_CUSTOM_IMAGE_REPOSITORY is missing/);
  const withoutDigest = { ...recipes.standard.environment, ...customImage };
  delete withoutDigest.COURTSIDE_CUSTOM_IMAGE_DIGEST;
  assert.match(render(files, withoutDigest).error, /required variable COURTSIDE_CUSTOM_IMAGE_DIGEST is missing/);
  const withoutSource = { ...recipes.standard.environment, ...customImage };
  delete withoutSource.COURTSIDE_SOURCE_URL;
  assert.match(render(files, withoutSource).error, /required variable COURTSIDE_SOURCE_URL is missing/);
});

test("given custom image mode, when image settings are hostile, then they cannot select a moving tag", () => {
  const files = resolved("files", "standard", "--overlay", "custom-image");
  for (const [repository, digest] of [
    ["registry.example.org/example/courtside:latest", "b".repeat(64)],
    ["registry.example.org/example/courtside", `sha512:${"b".repeat(128)}`],
    ["registry.example.org/example/courtside", "latest"],
  ]) {
    // given
    const environment = { ...recipes.standard.environment, ...customImage,
      COURTSIDE_CUSTOM_IMAGE_REPOSITORY: repository, COURTSIDE_CUSTOM_IMAGE_DIGEST: digest };

    // when
    const image = rendered(files, environment).services.app.image;

    // then
    assert.equal(image, `${repository}@sha256:${digest}`);
    assert.match(image, /@sha256:/, `custom settings escaped the immutable digest position: ${image}`);
  }
});

test("given an official image mode, when a recipe is rendered, then it carries no custom trust marker", () => {
  // when
  const app = rendered(resolved("files", "standard"), recipes.standard.environment).services.app;

  // then
  assert.equal(app.labels?.["org.courtside.image-trust"], undefined);
  assert.equal(app.image, `ghcr.io/jegr78/courtside@sha256:${common.COURTSIDE_IMAGE_DIGEST}`);
  const withoutDigest = { ...recipes.standard.environment };
  delete withoutDigest.COURTSIDE_IMAGE_DIGEST;
  assert.match(render(resolved("files", "standard"), withoutDigest).error,
    /required variable COURTSIDE_IMAGE_DIGEST is missing/);
});

test("given the component manifests, when the resolver's files are compared, then every selectable file is declared",
  () => {
    // given
    const production = manifest("x-courtside-production-overlays");
    const acceptance = manifest("x-courtside-acceptance-components");
    const selectable = new Set();
    for (const name of Object.keys(recipes)) resolved("files", name).forEach((f) => selectable.add(f));
    resolved("files", "existing-infrastructure", "--overlay", "database-tls").forEach((f) => selectable.add(f));
    resolved("files", "existing-infrastructure", "--overlay", "database-identities").forEach((f) => selectable.add(f));
    resolved("files", "standard", "--overlay", "database-identities", "--overlay", "database-tls",
      "--overlay", "database-tls-local", "--overlay", "app-tls").forEach((f) => selectable.add(f));
    resolved("files", "standard", "--overlay", "database-identities", "--overlay", "custom-image")
      .forEach((f) => selectable.add(f));
    resolved("files", "standard", "--synthetic-mail").forEach((f) => selectable.add(f));

    // when
    const declared = new Set(["compose.yaml", ...production, ...acceptance]);

    // then
    assert.deepEqual([...selectable].toSorted(), [...declared].toSorted());
    assert.equal(production.includes("compose.mailpit.yaml"), false,
      "synthetic mail is declared as a production component");
  });
