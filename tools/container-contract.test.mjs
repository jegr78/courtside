import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function repositoryFile(path) {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

function repositoryFiles(directory, extension) {
  const root = fileURLToPath(new URL(`../${directory}`, import.meta.url));
  return readdirSync(root, { recursive: true })
    .filter((name) => name.endsWith(extension))
    .map((name) => readFileSync(`${root}/${name}`, "utf8"));
}

function all(source, pattern) {
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))].sort();
}

const DISPOSABLE = /^COURTSIDE_(?:DEMO|PERF|SECURITY)_/;
// What Spring's ForwardedHeaderFilter reads under forward-headers-strategy: framework.
const FRAMEWORK_FORWARDED_HEADERS = ["Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Port",
  "X-Forwarded-Prefix", "X-Forwarded-Proto", "X-Forwarded-Ssl"];

const dockerfile = repositoryFile("Dockerfile");
const properties = repositoryFile("src/main/resources/application.yaml");
const compose = repositoryFile("deploy/compose.yaml");
const caddyfile = repositoryFile("deploy/Caddyfile");
const readme = repositoryFile("deploy/README.md");
const productionOverlays = /^x-courtside-production-overlays:\n(?<entries>(?:  - compose[\w.-]+\.yaml\n)+)/m
  .exec(compose)?.groups.entries.match(/compose[\w.-]+\.yaml/g) ?? [];
const sources = repositoryFiles("src/main/java", ".java");
const java = sources.join("\n");
const schema = repositoryFiles("src/main/resources/db/migration", ".sql").join("\n");
const javaFile = (name) => repositoryFile(`src/main/java/org/courtside/${name}.java`);
const contract = repositoryFile("deploy/container-contract.md");
// Markdown wraps its lines, so a phrase may be split anywhere a space is.
const prose = contract.replace(/\s+/g, " ");

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A bare substring would let "port 80" stand for "port 8080".
function states(text, value) {
  return new RegExp(`(?<![\\w/.-])${escaped(value)}(?![\\w/-])`).test(text);
}

function assertNamed(values, what, text = prose) {
  assert.ok(values.length > 0, `nothing executable names ${what}`);
  const missing = values.filter((value) => !states(text, value.replace(/\s+/g, " ")));
  assert.deepEqual(missing, [], `the container contract does not name ${what}`);
}

function section(heading) {
  const start = contract.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `the container contract has no section ${heading}`);
  const end = contract.indexOf("\n## ", start + heading.length + 2);
  return contract.slice(start, end < 0 ? undefined : end).replace(/\s+/g, " ");
}

function between(text, from, to) {
  const start = text.indexOf(from);
  assert.ok(start >= 0, `the container contract no longer says "${from}"`);
  const end = to ? text.indexOf(to, start + from.length) : -1;
  return text.slice(start, end < 0 ? undefined : end);
}

function backticked(text, pattern) {
  return all(text, new RegExp(`\`(${pattern.source})\``, "g"));
}

function appService(source) {
  return source.match(/^  app:\n(?<body>(?: {4}.*\n|\n)+)/m)?.groups.body ?? "";
}

function flattenedVariables(yaml) {
  const path = [];
  const variables = new Map();
  for (const line of yaml.split("\n")) {
    const entry = /^(?<indent> *)(?<key>[\w-]+):(?<value>.*)$/.exec(line);
    if (!entry) continue;
    path.length = entry.groups.indent.length / 2;
    path.push(entry.groups.key);
    const variable = /\$\{(COURTSIDE_[A-Z0-9_]+):(.*)\}/.exec(entry.groups.value);
    if (variable) variables.set(path.join("."), { name: variable[1], fallback: variable[2] });
  }
  return variables;
}

const bound = flattenedVariables(properties);

test("given the image, when the contract describes its process, then it states the user, port, memory and logs",
  () => {
    // given
    const user = /^USER (\d+):(\d+)$/m.exec(dockerfile);
    const port = /^EXPOSE (\d+)$/m.exec(dockerfile)?.[1];
    const memory = /MaxRAMPercentage=([\d.]+)/.exec(dockerfile)?.[1];

    // when / then
    assert.ok(user && port && memory, "the Dockerfile no longer states a user, a port or a memory share");
    assert.match(dockerfile, /-XX:\+ExitOnOutOfMemoryError/, "the image no longer exits on OutOfMemoryError");
    assert.match(properties, /console: ecs/, "the application no longer logs Elastic Common Schema");
    assertNamed([`UID ${user[1]}`, `GID ${user[2]}`, `port ${port}`, `${Number.parseFloat(memory)} percent`,
      "exits on an `OutOfMemoryError`", "Elastic Common Schema JSON object per line"], "the process");
  });

test("given the image's health check, when the contract describes health, then it states the path, timing and body",
  () => {
    // given
    const check = /^HEALTHCHECK (?<options>.*?)(?:\\\n)?\s*CMD .*?(?<scheme>https?):\/\/[^/\s"']+(?<path>\/[^\s"']+)/ms
      .exec(dockerfile);
    const [interval, timeout, startPeriod, retries] = ["interval", "timeout", "start-period", "retries"]
      .map((name) => new RegExp(`--${name}=(\\d+)`).exec(check?.groups.options ?? "")?.[1]);
    const count = ["zero", "one", "two", "three", "four", "five"];
    const endpoint = /^  endpoint:\n {4}health:\n(?<body>(?: {6}.*\n)+)/m.exec(properties)?.groups.body ?? "";
    const groups = [
      ...(/probes:\n\s+enabled: true/.test(endpoint) ? ["liveness", "readiness"] : []),
      ...all(/ {6}group:\n(?<groups>(?: {8}.*\n)+)/.exec(endpoint)?.groups.groups ?? "", /^ {8}(\w+):$/gm),
    ].sort();
    const body = JSON.stringify({ ...(groups.length ? { groups } : {}), status: "UP" });

    // when / then
    assert.ok(check && interval && timeout && startPeriod && retries,
      "the Dockerfile no longer declares a complete health check");
    assert.equal(/exposure:\n\s+include: (\S+)/.exec(properties)?.[1], "health",
      "the application exposes more than its health endpoint");
    assert.match(endpoint, /^ {6}show-details: never$/m, "the health endpoint now shows its components");
    const security = javaFile("identity/internal/SecurityConfiguration");
    assert.match(security, new RegExp(`"${escaped(check.groups.path)}"\\)\\.permitAll\\(\\)`),
      "the health endpoint no longer answers anonymous requests");
    assert.match(security, new RegExp(`"${escaped(check.groups.path)}/\\*\\*"\\)\\.access\\([^;]*ROLE_[^;]*ADMIN`, "s"),
      "the probe groups no longer require an administrator");
    assertNamed([
      "An anonymous probe gets `401`",
      `\`GET ${check.groups.path}\` answers without authentication`,
      `the body \`${body}\``,
      "carries no components",
      `health check against \`${check.groups.path}\`: every ${interval} seconds, a ${timeout} second timeout, `
        + `${count[retries]} retries and a start period of \`${startPeriod}s\``,
      `The declared check requests plain ${check.groups.scheme.toUpperCase()}`,
    ], "the health check and its response");
  });

test("given the reference application service, when the contract describes the filesystem, then it names exactly the writable paths",
  () => {
    // given
    const service = appService(compose);
    const tmpfs = /^ {4}tmpfs:(?<paths>(?: \[.*\])?\n(?: {6}- .*\n)*)/m.exec(service)?.groups.paths ?? "";
    const writable = all(tmpfs, /(?:^ {6}- |[[,]\s*)(\/[^\s,\]]+)/gm);
    const stated = backticked(between(prose, "The only writable path it needs is", "which"), /\/[^`]+/);

    // when / then
    assert.match(service, /^ {4}read_only: true$/m, "the reference application no longer runs read-only");
    assert.ok(writable.length > 0, "the reference application no longer mounts a writable path");
    assert.deepEqual(stated, writable, "the container contract names other writable paths than the reference");
  });

test("given the bundled database and migrations, when the contract describes PostgreSQL, then it names the version, extensions and transport refusal",
  () => {
    // given
    const major = /image: postgres:(\d+)/.exec(compose)?.[1];
    const extensions = all(`${schema}\n${java}`, /create extension (?:if not exists )?"?(\w+)"?/gi);
    const stated = backticked(between(prose, "The schema needs the", "extension"), /\w+/);
    const tls = javaFile("shared/DatabaseTls");
    const parameter = (name) => new RegExp(`${name} = "(\\w+)"`).exec(tls)?.[1];

    // when / then
    assert.ok(major, "the reference deployment no longer pins a PostgreSQL major version");
    assert.deepEqual(stated, extensions, "the container contract names other extensions than the schema needs");
    assertNamed([`PostgreSQL ${major}`,
      `an \`${parameter("TRANSPORT_PARAMETER")}…\` or \`${parameter("GSS_PARAMETER")}…\` argument or \`${parameter("SERVICE_PARAMETER")}\``],
    "the database version and the transport refusal");
  });

test("given the image's one-shot commands, when the contract describes migrations, then each command, its invocation and its input are stated",
  () => {
    // given
    const commands = all(java, /"(--courtside-[a-z-]+)"/g);
    const setup = javaFile("shared/DatabaseProvisioning");
    const migration = javaFile("shared/DatabaseMigration");
    const shared = ["SPRING_DATASOURCE_URL", ...all(migration, /"(COURTSIDE_DB_TLS_[A-Z_]+)"/g)];
    const read = (source) => all(source, /"((?:COURTSIDE|SPRING)_[A-Z0-9_]+)"/g).filter((name) => !shared.includes(name));
    const identity = javaFile("shared/DatabaseIdentityEnvironmentPostProcessor");
    const urlCredentials = /new String\[\]\{(?<names>[^}]+)\}/.exec(identity)?.groups.names.match(/\w+/g) ?? [];

    // when / then
    assert.deepEqual(backticked(prose, /--courtside-[a-z-]+/), commands,
      "the container contract names other one-shot commands than the image has");
    for (const source of [setup, migration]) {
      assert.match(source, /arguments\.length == 1 && COMMAND\.equals\(arguments\[0\]\)/,
        "a one-shot command no longer requires being the only argument");
      assert.match(source, /System\.getenv|Map<String, String> environment/, "a one-shot command reads another source");
    }
    assertNamed(["the only argument to the image's entrypoint", "environment variables only"], "the invocation");
    assertNamed(read(setup).map((name) => `\`${name}\``), "what setup reads",
      between(prose, "1. `--courtside-database-setup`", "2. `"));
    assertNamed(read(migration).map((name) => `\`${name}\``), "what migration reads",
      between(prose, "2. `--courtside-database-migrate`", "3. "));
    assertNamed(shared.map((name) => `\`${name}\``), "what all three processes read",
      between(prose, "All three processes read", "[Separating"));
    const longest = Number(/ROLE_NAME = Pattern\.compile\("\[a-z\]\[a-z0-9_\]\{0,(\d+)\}"\)/.exec(setup)?.[1]) + 1;
    assert.ok(longest > 1, "the role name rule changed shape");
    assertNamed([`at most ${longest} lower-case letters`, "`postgres`", "`pg_`",
      ...urlCredentials.map((name) => `\`${name}\``)], "the role name and address refusals");
  });

test("given the image's variables, when the contract lists them, then the set and every default match the image",
  () => {
    // given
    const expected = new Map([...bound.values()].map(({ name, fallback }) => [name,
      fallback === "" ? "unset" : fallback === "@project.url@" ? "this repository" : `\`${fallback}\``]));
    for (const name of all(java, /"(COURTSIDE_[A-Z0-9_]+)"/g)) {
      if (!DISPOSABLE.test(name) && !expected.has(name)) expected.set(name, "unset");
    }
    const table = between(contract, "| Variable | Default |");
    const listed = new Map([...table.matchAll(/^\| `(COURTSIDE_[A-Z0-9_]+)` \| (.+?) \|$/gm)]
      .map((row) => [row[1], row[2]]));
    const readmeTable = between(readme, "\n## Environment variables\n", "\n## ");
    const undocumented = [...expected.keys()].filter((name) => !readmeTable.includes(`| \`${name}\` |`)).sort();
    const exceptions = backticked(between(prose, "from the `.env` side, except", "which this page describes"),
      /COURTSIDE_[A-Z0-9_]+/);

    // when / then
    assert.deepEqual([...listed.keys()].sort(), [...expected.keys()].sort(),
      "the container contract lists other variables than the image reads");
    assert.deepEqual(Object.fromEntries(listed), Object.fromEntries(expected),
      "the container contract states another default than the image has");
    assert.deepEqual(exceptions, undocumented,
      "the variables the README table does not describe are not the ones the contract says it describes");
    const described = contract.slice(0, contract.indexOf("| Variable | Default |")).replace(/\s+/g, " ");
    assertNamed(undocumented.map((name) => `\`${name}\``), "the variables only this page describes",
      described.slice(0, described.indexOf("## Environment variables")));
  });

test("given the startup refusals, when the contract lists required input, then each refusal it depends on is stated",
  () => {
    // given
    const mail = javaFile("notification/internal/MailSettings");
    const bootstrap = javaFile("identity/internal/BootstrapAdminInitializer");
    const refusedMail = all(mail, /(?:requirePresent|requireAddress)\(problems, "(COURTSIDE_[A-Z0-9_]+)"/g);
    const refusedBootstrap = all(bootstrap, /required(?:Secret)?\(\s*"(COURTSIDE_[A-Z0-9_]+)"/g);
    const minimum = /password\.length\(\) < (\d+)/.exec(bootstrap)?.[1];
    const designations = /DISPOSABLE_DESIGNATIONS =\s*Set\.of\(([^)]*)\)/.exec(javaFile("shared/ClockConfiguration"))?.[1]
      .match(/\w+/g) ?? [];

    // when / then
    assert.ok(refusedMail.length >= 3 && refusedBootstrap.length >= 3 && minimum,
      "the startup refusals for mail and the first administrator changed shape");
    assert.ok(designations.length > 0 && !designations.includes("PRODUCTION"),
      "the fixed clock no longer names only disposable designations");
    assert.match(javaFile("identity/internal/SecurityConfiguration"), /COURTSIDE_COOKIE_SECURE=false is reserved/,
      "the insecure cookie refusal is no longer named in the security configuration");
    assertNamed(refusedMail.map((name) => `\`${name}\``), "the mail refusals", section("## Mail"));
    assertNamed([...refusedBootstrap.map((name) => `\`${name}\``), `at least ${minimum} characters`],
      "the first administrator's refusals", section("## Required input and refusals"));
    assertNamed(["refuses to start with that switch lowered"], "the insecure cookie refusal", section("## HTTPS ingress"));
    assertNamed([`\`COURTSIDE_ENVIRONMENT\` names anything but ${designations.slice(0, -1).map((name) => `\`${name}\``)
      .join(", ")} or \`${designations.at(-1)}\``], "the fixed clock refusal", section("## Required input and refusals"));
  });

test("given the image's file inputs, when the contract lists them, then it lists exactly those",
  () => {
    // given
    const pathProperties = sources.flatMap((source) => {
      const declared = /@ConfigurationProperties\("([\w.-]+)"\)\s*record \w+\((?<components>[^)]*)\)/s.exec(source);
      if (!declared) return [];
      return all(declared.groups.components, /Path (\w+)/g)
        .map((component) => `${declared[1]}.${component.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
    });
    const files = [...new Set([
      ...pathProperties.map((key) => bound.get(key)?.name),
      ...[...bound].filter(([key]) => key.endsWith("-file")).map(([, variable]) => variable.name),
      ...all(java, /"(COURTSIDE_[A-Z0-9_]+_FILE)"/g).filter((name) => !DISPOSABLE.test(name)),
    ])].sort();
    const listed = all(between(contract, "These inputs are paths to files", "No other input"),
      /^- `(COURTSIDE_[A-Z0-9_]+)`$/gm);

    // when / then
    assert.ok(pathProperties.length > 0 && !files.includes(undefined), "a Path property has no variable");
    assert.deepEqual(listed, files, "the container contract lists other file inputs than the image reads");
  });

test("given the reference proxy and the mail transport, when the contract describes ingress and mail, then it names every forwarded header and STARTTLS",
  () => {
    // given
    const headers = /\(applicationHeaders\) \{\n(?<body>(?:[\t ]+.*\n)+)\}/.exec(caddyfile)?.groups.body ?? "";
    const discarded = all(headers, /header_up -(\S+)/g);
    const written = all(headers, /header_up (?!-)(\S+) /g);
    const transport = javaFile("notification/internal/NotificationConfiguration");
    const trust = between(prose, "The application trusts the forwarded headers", "It takes");
    const writes = between(prose, "then write", "itself");

    // when / then
    assert.equal(/forward-headers-strategy: (\S+)/.exec(properties)?.[1], "framework",
      "the application changed how it reads forwarded headers");
    assert.ok(discarded.length > 0 && written.length > 0, "the reference proxy no longer normalises forwarded headers");
    assert.match(transport, /"mail\.smtp\.starttls\.required", "true"/, "the mail relay no longer requires STARTTLS");
    assert.deepEqual(backticked(trust, /[\w-]+/), [...FRAMEWORK_FORWARDED_HEADERS].sort(),
      "the container contract names other forwarded headers than the application trusts");
    assert.deepEqual(FRAMEWORK_FORWARDED_HEADERS.filter((name) => ![...discarded, ...written].includes(name)), [],
      "the reference proxy no longer normalises every forwarded header the application trusts");
    assertNamed(written.map((name) => `\`${name}`), "the headers the ingress writes", writes);
    assertNamed([`So port ${/^EXPOSE (\d+)$/m.exec(dockerfile)?.[1]} must be reachable only from the ingress`,
      "writes `X-Forwarded-For` as a single value"], "the ingress boundary", section("## HTTPS ingress"));
    assertNamed(["always requires STARTTLS"], "the relay's transport requirement", section("## Mail"));
  });

test("given the breach check, when the contract describes the network, then it names the endpoint the image must reach",
  () => {
    // given
    const endpoint = new URL([...bound.values()].find(({ name }) => name === "COURTSIDE_PASSWORD_BREACH_ENDPOINT").fallback);

    // when / then
    const unavailable = /HttpStatus\.(\w+)/.exec(javaFile("identity/internal/BreachedPasswordCheckUnavailableException"))?.[1];
    assert.equal(unavailable, "SERVICE_UNAVAILABLE", "an unavailable breach check no longer answers 503");
    assert.match(javaFile("identity/internal/SecurityConfiguration"), /cannot override HIBP in production/,
      "the breach endpoint override refusal is no longer named in the security configuration");
    assertNamed([`\`${endpoint.host}\` over ${endpoint.protocol.replace(":", "").toUpperCase()}`,
      "`COURTSIDE_PASSWORD_BREACH_ENDPOINT` cannot point anywhere else", "refuses the change with `503`"],
    "the breach check", section("## Network"));
  });

test("given the reference Compose files, when the contract maps their names, then every renamed input is named",
  () => {
    // given
    const renamed = new Set();
    for (const file of ["compose.yaml", ...productionOverlays]) {
      const service = appService(repositoryFile(`deploy/${file}`));
      for (const entry of service.matchAll(/^ {6}([A-Z][A-Z0-9_]*): (.*\$\{.*)$/gm)) {
        all(entry[2], /\$\{([A-Z][A-Z0-9_]*)/g).filter((name) => name !== entry[1])
          .forEach((name) => renamed.add(name).add(entry[1]));
      }
      for (const mount of service.matchAll(/^ {6}- "?\$\{([A-Z][A-Z0-9_]*)[^}]*\}:\//gm)) {
        if (!bound.has(mount[1]) && ![...bound.values()].some(({ name }) => name === mount[1])) renamed.add(mount[1]);
      }
    }
    const mapping = between(prose, "These are the names inside the container", "keep their names but not their meaning");

    // when / then
    assert.ok(productionOverlays.length > 0 && renamed.size > 0, "the reference Compose files rename no input");
    assertNamed([...renamed].sort().map((name) => `\`${name}\``), "every input the reference Compose files rename", mapping);
  });
