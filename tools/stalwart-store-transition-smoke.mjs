import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { connect as connectTls } from "node:tls";
import { fileURLToPath } from "node:url";

import { archiveEntries, executable, manifestOf } from "./deployment-archive.mjs";

const repository = fileURLToPath(new URL("..", import.meta.url));
const YAML = createRequire(new URL("../frontend/package.json", import.meta.url))("yaml");
const sourceRevision = "89d8961e93e301a019f22c48dd455b09ce09fef1";
const runtimeImage = "ghcr.io/jegr78/courtside@sha256:34da21a2b9a30ee48640d4bd6fa591e28d16771dcb1b359408f8604a26fcf26f";
const hash = (content) => createHash("sha256").update(content).digest("hex");

export function validateTransitionCandidate(root) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json")));
  const nightly = /^[0-9]+\.[0-9]+\.[0-9]+-nightly\.[1-9][0-9]*$/.test(manifest.version ?? "");
  const signer = `https://github.com/jegr78/courtside/.github/workflows/${nightly
    ? "nightly-image.yml@refs/heads/main" : `release.yml@refs/tags/v${manifest.version}`}`;
  if (manifest.schema !== 1 || !/^ghcr\.io\/jegr78\/courtside@sha256:[a-f0-9]{64}$/.test(manifest.image ?? "")
    || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version ?? "")
    || !/^[a-f0-9]{40}$/.test(manifest.revision ?? "") || manifest.signer !== signer) {
    throw new Error("transition qualification requires a Courtside candidate identity");
  }
  if (!manifest.files?.courtside) throw new Error("candidate archive has no launcher inventory");
  for (const [path, expected] of Object.entries(manifest.files)) {
    if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) || path.split("/").includes("..")) {
      throw new Error("candidate inventory contains an unsafe path");
    }
    const absolute = join(root, path);
    if (!lstatSync(absolute).isFile()) throw new Error("candidate inventory must contain regular files without symlinks");
    if (!realpathSync(absolute).startsWith(`${realpathSync(root)}/`)) throw new Error("candidate inventory leaves its archive root");
    if (hash(readFileSync(absolute)) !== expected) throw new Error("candidate archive integrity failed");
  }
  const actualFiles = filesBelow(root).filter((path) => path !== "manifest.json");
  if (actualFiles.length !== Object.keys(manifest.files).length || actualFiles.some((path) => !manifest.files[path])) {
    throw new Error("candidate inventory contains undeclared files");
  }
  return manifest;
}

export function canRemoveQualificationVolume(name, labels, project) {
  return name.startsWith(`${project}_`) && labels?.["com.docker.compose.project"] === project;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repository, encoding: options.binary ? undefined : "utf8",
    maxBuffer: 64 * 1024 * 1024, timeout: 180_000, ...options });
  if ((result.error || result.status !== 0) && !options.allowFailure) {
    const error = new Error(`${command} ${args[0]} failed`);
    error.detail = `${result.error?.message ?? ""}\n${result.stdout?.toString() ?? ""}\n${result.stderr?.toString() ?? ""}`;
    throw error;
  }
  return result;
}

async function until(label, operation) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try { if (await operation()) return; } catch { /* The read-only readiness probe has no side effects. */ }
    await new Promise((wake) => setTimeout(wake, 1000));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function filesBelow(root, prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = join(prefix, entry.name);
    return entry.isDirectory() ? filesBelow(root, relative) : [relative];
  });
}

function adaptNetwork(root, authority) {
  for (const file of ["compose.yaml", "compose.caddy.yaml", "compose.caddy-public.yaml", "compose.stalwart.yaml"]) {
    const path = join(root, file);
    const model = YAML.parse(readFileSync(path, "utf8"), { logLevel: "silent" });
    for (const [name, service] of Object.entries(model.services ?? {})) {
      if (service.logging) service.logging = { driver: "json-file", options: { "max-size": "1m", "max-file": "1" } };
      if (service.ports) service.ports = name === "log-collector" ? []
        : service.ports.map((port) => `127.0.0.1::${String(port).split(":").at(-1)}`);
      if (name === "mail" && !service.ports?.some((port) => port.endsWith(":587"))) service.ports.push("127.0.0.1::587");
      if (name === "mail-ready" || name === "mail-reload") {
        service.environment.COURTSIDE_MAIL_RELOAD_CA_FILE = "/qualification-ca.pem";
        service.volumes.push(`${authority}:/qualification-ca.pem:ro`);
      }
    }
    writeFileSync(path, YAML.stringify(model));
  }
  writeFileSync(join(root, "Caddyfile"), `{
  auto_https disable_redirects
}
{$COURTSIDE_DOMAIN} {
  tls internal
  respond 404
}
{$COURTSIDE_MAIL_HOSTNAME} {
  tls internal
  respond 404
}
`);
}

function archiveFixture(root, version, revision, image, productionEntries = false) {
  const entries = productionEntries ? archiveEntries(root) : filesBelow(root)
    .filter((path) => path !== "manifest.json").map((path) => ({ path, content: readFileSync(join(root, path)) }));
  const manifest = manifestOf({ version, revision, image, bookingSeedImage: image,
    repository: "jegr78/courtside", ref: version.includes("-nightly.") ? "refs/heads/main" : `refs/tags/v${version}`,
    workflow: version.includes("-nightly.") ? "nightly-image.yml" : "release.yml", entries });
  if (productionEntries) {
    const carried = new Set(entries.map((entry) => entry.path));
    for (const path of filesBelow(root)) if (path !== "manifest.json" && !carried.has(path)) rmSync(join(root, path));
  }
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  validateTransitionCandidate(root);
}

function environmentValue(installation, key) {
  const match = new RegExp(`^${key}="([^"]*)"$`, "m")
    .exec(readFileSync(join(installation, "config", ".env"), "utf8"));
  return match?.[1] ?? "";
}

function setEnvironment(installation, key, value) {
  assert.match(value, /^[A-Za-z0-9.:_@/-]*$/);
  const path = join(installation, "config", ".env");
  const text = readFileSync(path, "utf8").replace(new RegExp(`^${key}=.*\\n?`, "gm"), "");
  writeFileSync(path, `${text}${key}="${value}"\n`, { mode: 0o600 });
}

class Smtp {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    socket.on("data", (chunk) => { this.buffer += chunk.toString("utf8"); });
    socket.on("error", () => {});
    socket.setTimeout(20_000, () => socket.destroy());
  }
  async reply(expected) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const last = this.buffer.split("\r\n").filter(Boolean).at(-1);
      if (last && /^\d{3} /.test(last)) {
        this.buffer = "";
        assert.equal(last.slice(0, 3), expected, "SMTP returned another status");
        return;
      }
      if (this.socket.destroyed) throw new Error("SMTP closed before its complete reply");
      await new Promise((wake) => setTimeout(wake, 20));
    }
    throw new Error("SMTP reply timed out");
  }
  async send(line, expected) {
    this.socket.write(`${line}\r\n`);
    await this.reply(expected);
  }
}

async function deliver(port, authority, sender, password) {
  const socket = createConnection({ host: "127.0.0.1", port });
  const plain = new Smtp(socket);
  try {
    await plain.reply("220");
    await plain.send("EHLO courtside-transition", "250");
    await plain.send("STARTTLS", "220");
    const secure = connectTls({ socket, ca: authority, servername: "mail.courts.example.org", rejectUnauthorized: true });
    const session = new Smtp(secure);
    try {
      await new Promise((ready, reject) => secure.once("secureConnect", ready).once("error", reject));
      await session.send("EHLO courtside-transition", "250");
      await session.send(`AUTH PLAIN ${Buffer.from(`\0${sender}\0${password}`).toString("base64")}`, "235");
      await session.send(`MAIL FROM:<${sender}>`, "250");
      await session.send("RCPT TO:<jane.doe@example.org>", "250");
      await session.send("DATA", "354");
      await session.send(`From: ${sender}\r\nTo: jane.doe@example.org\r\nSubject: Transition probe\r\n\r\nSynthetic transition probe.\r\n.`, "250");
      await session.send("QUIT", "221");
    } finally { secure.destroy(); }
  } finally { socket.destroy(); }
}

async function execute() {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--candidate")) {
    throw new Error("usage: stalwart-store-transition-smoke.mjs [--candidate <deployment directory>]");
  }
  const supplied = args.length ? resolve(args[1]) : undefined;
  const suppliedManifest = supplied ? validateTransitionCandidate(supplied) : undefined;
  const scratch = mkdtempSync(join(tmpdir(), "courtside-stalwart-transition-"));
  chmodSync(scratch, 0o700);
  const project = `courtside-transition-${randomBytes(8).toString("hex")}`;
  const installation = join(scratch, "installation");
  const authorityFile = join(scratch, "authority.pem");
  writeFileSync(authorityFile, "", { mode: 0o644 });
  const source = join(scratch, "historical", "deploy");
  const candidate = join(scratch, "candidate");
  const evidence = join(repository, "build", "stalwart-store-transition");
  rmSync(join(evidence, "result.json"), { force: true });
  const image = suppliedManifest?.image ?? runtimeImage;
  let stage = "fixtures";
  let passed = false;
  const restoredContainers = [];
  const restoredVolumes = [];
  const compose = (root, arguments_, options) => {
    const names = run(join(root, "recipe.sh"), ["files", "full-self-hosted"]).stdout.trim().split("\n");
    return run("docker", ["compose", "--project-name", project, "--project-directory", root,
      "--env-file", join(installation, "config", ".env"), ...names.flatMap((file) => ["-f", join(root, file)]),
      ...arguments_], options);
  };
  const launcher = (root, arguments_, options) => run("/bin/bash", [join(root, "courtside"),
    "--directory", installation, ...arguments_], options);
  const psql = (sql) => compose(join(installation, "current"), ["exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1",
    "-U", "courtside", "-d", "courtside", "-At", "-f", "/dev/stdin"], { input: sql }).stdout.trim();
  const port = (root, service, internal) => Number(compose(root, ["port", service, String(internal)]).stdout.trim().split(":").at(-1));
  const cli = (root, arguments_, options = {}) => compose(root, ["--profile", "mail-setup", "run", "--rm", "--no-deps", "mail-bootstrap", ...arguments_], options);
  try {
    mkdirSync(join(scratch, "historical"));
    const historical = run("git", ["archive", "--format=tar", sourceRevision, "deploy"], { binary: true });
    run("tar", ["-xf", "-", "-C", join(scratch, "historical")], { input: historical.stdout });
    cpSync(supplied ?? join(repository, "deploy"), candidate, { recursive: true });
    const immutable = ["courtside", "mail-store-transition.sh", "mail-ready.mjs", "mail-certificate-peer.mjs", "mail/base.ndjson", "mail/bootstrap.ndjson"];
    const originalHashes = Object.fromEntries(immutable.map((file) => [file, hash(readFileSync(join(candidate, file)))]));
    adaptNetwork(source, authorityFile);
    adaptNetwork(candidate, authorityFile);
    archiveFixture(source, "0.0.0", sourceRevision, image);
    archiveFixture(candidate, suppliedManifest?.version ?? "0.4.0-rc.999", suppliedManifest?.revision
      ?? run("git", ["rev-parse", "HEAD"]).stdout.trim(), image, !supplied);
    assert.deepEqual(Object.fromEntries(immutable.map((file) => [file, hash(readFileSync(join(candidate, file)))])), originalHashes);
    const answers = join(scratch, "answers.conf");
    writeFileSync(answers, `schema=1\nrecipe=full-self-hosted\noverlays=\nsynthetic_mail=false\nrootless_port_start=0\nproject=${project}\ndomain=courts.example.org\nbootstrap_username=admin\nbootstrap_display_name=Jane Doe\nsource_url=https://github.com/example/courtside\nmail_domain=courts.example.org\nmail_reply_to=board@example.org\nmail_relay_host=\nmail_relay_username=\ndatabase_url=\ndatabase_username=\n`, { mode: 0o600 });
    launcher(source, ["init", "--answers", answers, "--yes"]);
    stage = "source application";
    process.stdout.write("Starting the disposable historical deployment.\n");
    compose(source, ["up", "-d", "--wait"]);
    stage = "source mail bootstrap";
    setEnvironment(installation, "COURTSIDE_MAIL_RECOVERY_ADMIN", `admin:${environmentValue(installation, "COURTSIDE_MAIL_SETUP_PASSWORD")}`);
    compose(source, ["--profile", "mail", "up", "-d", "mail", "mail-certificate"]);
    await until("source Bootstrap", () => cli(source, ["get", "Bootstrap"], { allowFailure: true }).status === 0);
    const bootstrap = compose(source, ["--profile", "mail-setup", "run", "--rm", "mail-bootstrap"], { allowFailure: true });
    if (bootstrap.status !== 0) {
      assert.match(`${bootstrap.stdout}${bootstrap.stderr}`, /authentication failed \(HTTP 401\)/);
      compose(source, ["exec", "-T", "mail", "sh", "-c", "test -s /etc/stalwart/config.json"]);
    }
    compose(source, ["restart", "mail"]);
    await until("source settings", () => cli(source, ["get", "SystemSettings"], { allowFailure: true }).status === 0);
    const authority = compose(source, ["exec", "-T", "proxy", "cat", "/data/caddy/pki/authorities/local/root.crt"]).stdout;
    writeFileSync(authorityFile, authority);
    compose(source, ["--profile", "mail", "up", "-d", "--wait", "mail-certificate"]);
    compose(source, ["--profile", "mail-setup", "run", "--rm", "mail-configure"]);
    setEnvironment(installation, "COURTSIDE_MAIL_RECOVERY_ADMIN", "");
    compose(source, ["--profile", "mail", "up", "-d", "--force-recreate", "mail"]);
    compose(source, ["--profile", "mail", "up", "-d", "--wait", "mail-reload"]);
    compose(source, ["exec", "-T", "mail", "sh", "-c", "printf source-store > /var/lib/stalwart/transition-sentinel"]);
    stage = "source persisted data";
    psql(`INSERT INTO court (id, number, name, active) VALUES ('70000000-0000-0000-0000-000000000001', 7, 'Transition court', true);
INSERT INTO booking (id, card_id, status, booked_by, note)
SELECT '77000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'CONFIRMED', id, 'Transition probe' FROM user_account WHERE username='admin';
INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status)
VALUES ('78000000-0000-0000-0000-000000000001', '77000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', '2025-01-05T09:00:00Z', '2025-01-05T10:00:00Z', 'CONFIRMED');
UPDATE user_account SET password_change_required=false WHERE username='admin';`);
    const snapshotSql = "SELECT jsonb_build_object('booking',(SELECT to_jsonb(b) FROM booking b WHERE id='77000000-0000-0000-0000-000000000001'),'allocation',(SELECT to_jsonb(a) FROM court_allocation a WHERE id='78000000-0000-0000-0000-000000000001'),'account',(SELECT to_jsonb(u) FROM user_account u WHERE username='admin'))::text;";
    const before = psql(snapshotSql);
    const keyHashes = () => compose(join(installation, "current"), ["run", "--rm", "--no-deps", "-T", "--entrypoint", "sh", "app", "-ec", "find /var/lib/courtside/mfa-keys -type f -exec sha256sum {} +"]).stdout;
    if (!keyHashes().trim()) {
      const instance = randomUUID();
      const active = randomUUID();
      const helper = YAML.parse(readFileSync(join(source, "compose.stalwart.yaml"), "utf8")).services["mail-plan"].image;
      run("docker", ["run", "--rm", "-i", "--network", "none", "-v", `${project}_mfa-keys:/keys`, helper, "sh", "-ec",
        `umask 077; mkdir /keys/${instance}; cat > /keys/${instance}/mfa.keys; chown -R 10001:10001 /keys`],
      { input: `format=1\nactive=${active}\nkey.${active}=${randomBytes(32).toString("base64url")}\n` });
    }
    const keys = keyHashes();
    assert.match(keys, /^[a-f0-9]{64}\s+.*\/mfa\.keys/m, "the source must contain persistent key material");
    stage = "transition preflight";
    const beforeEnvironment = readFileSync(join(installation, "config", ".env"), "utf8");
    const preview = launcher(candidate, ["update-check", "--archive", candidate, "--mail-store-transition", "reinitialize"]);
    assert.match(preview.stdout, /mail_transition=reinitialize/);
    assert.equal(readFileSync(join(installation, "config", ".env"), "utf8"), beforeEnvironment);
    assert.equal(launcher(candidate, ["update", "--archive", candidate, "--yes"], { allowFailure: true }).status, 2);
    stage = "candidate launcher transition";
    process.stdout.write("Updating through the candidate launcher with explicit reinitialization.\n");
    const bin = join(scratch, "bin");
    mkdirSync(bin);
    const fault = join(scratch, "interrupt-activation");
    writeFileSync(fault, "once", { mode: 0o600 });
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
    writeFileSync(join(bin, "docker"), `#!/bin/sh
case "$*" in
  *'--project-name ${project} '*' up -d --wait')
    if [ -f ${quote(fault)} ]; then
      /bin/rm ${quote(fault)}
      kill -KILL "$PPID"
      exit 137
    fi
    ;;
esac
exec ${quote(executable("docker"))} "$@"
`, { mode: 0o755 });
    const update = ["update", "--archive", candidate, "--mail-store-transition", "reinitialize", "--yes"];
    const interrupted = launcher(candidate, update, { allowFailure: true,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` } });
    assert.ok(interrupted.signal === "SIGKILL" || interrupted.status === 137, "the fixture must interrupt activation, not fail earlier");
    assert.equal(readFileSync(join(installation, ".courtside-mail-transition", "phase"), "utf8").trim(), "activating");
    assert.equal(launcher(candidate, ["up"], { allowFailure: true }).status, 2);
    stage = "interrupted activation recovery";
    launcher(candidate, update);
    const current = join(installation, "current");
    assert.equal(psql(snapshotSql), before, "the transition changed application data");
    assert.equal(keyHashes(), keys);
    assert.match(environmentValue(installation, "COURTSIDE_MAIL_DATA_VOLUME"), /_mail-data-stalwart1-/);
    const mounts = JSON.parse(run("docker", ["inspect", `${project}-mail-1`]).stdout)[0].Mounts;
    assert.equal(mounts.find((mount) => mount.Destination === "/etc/stalwart").Name,
      environmentValue(installation, "COURTSIDE_MAIL_CONFIG_VOLUME"));
    assert.equal(mounts.find((mount) => mount.Destination === "/var/lib/stalwart").Name,
      environmentValue(installation, "COURTSIDE_MAIL_DATA_VOLUME"));
    const archiveHelper = YAML.parse(readFileSync(join(candidate, "compose.stalwart.yaml"), "utf8")).services["mail-plan"].image;
    assert.equal(run("docker", ["run", "--rm", "--network", "none", "-v", `${project}_mail-data:/source:ro`,
      archiveHelper, "cat", "/source/transition-sentinel"]).stdout, "source-store");
    compose(current, ["exec", "-T", "mail", "sh", "-c", "test ! -e /var/lib/stalwart/transition-sentinel; printf target-store > /var/lib/stalwart/transition-sentinel"]);
    stage = "authenticated delivery";
    compose(current, ["--profile", "mail-setup", "run", "--rm", "--no-deps", "mail-ready"]);
    assert.notEqual(compose(current, ["--profile", "mail-setup", "run", "--rm", "--no-deps", "-e", "COURTSIDE_MAIL_PASSWORD=wrong-placeholder", "mail-ready"], { allowFailure: true }).status, 0);
    const sinkImage = YAML.parse(readFileSync(join(repository, "deploy", "compose.mailpit.yaml"), "utf8")).services.mailpit.image;
    run("docker", ["run", "-d", "--name", `${project}-sink`, "--label", `com.docker.compose.project=${project}`,
      "--network", `${project}_mail-delivery`, "--network-alias", "sink", "-p", "127.0.0.1::8025", sinkImage]);
    compose(current, ["--profile", "mail-setup", "run", "--rm", "--no-deps", "-e", "COURTSIDE_MAIL_SINK=sink", "--entrypoint", "sh", "mail-plan", "/mail/render.sh", "journey"]);
    compose(current, ["--profile", "mail-setup", "run", "--rm", "--no-deps", "-e", "STALWART_USER", "-e", "STALWART_PASSWORD", "mail-configure", "apply", "--file", "/plan/journey.ndjson"],
      { env: { ...process.env, STALWART_USER: "postmaster@courts.example.org", STALWART_PASSWORD: environmentValue(installation, "COURTSIDE_MAIL_ADMIN_PASSWORD") } });
    compose(current, ["restart", "mail"]);
    compose(current, ["--profile", "mail", "up", "-d", "--wait", "mail", "mail-reload"]);
    await deliver(port(current, "mail", 587), authority, "courtside@courts.example.org", environmentValue(installation, "COURTSIDE_MAIL_PASSWORD"));
    const sinkPort = run("docker", ["port", `${project}-sink`, "8025"]).stdout.trim().split(":").at(-1);
    await until("controlled message delivery", async () => (await (await fetch(`http://127.0.0.1:${sinkPort}/api/v1/messages`)).json()).total === 1);
    stage = "post-transition backup and mail restore";
    launcher(current, ["backup"]);
    const units = readdirSync(join(installation, "backups")).filter((name) => name.startsWith("recovery-"));
    assert.equal(units.length, 2);
    run("docker", ["rm", "-f", `${project}-sink`]);
    compose(current, ["--profile", "*", "down", "--remove-orphans"]);
    for (const [index, unit] of units.entries()) {
      const backup = join(installation, "backups", unit);
      launcher(current, ["restore-check", "--recovery", backup], { env: { ...process.env,
        COURTSIDE_RESTORE_USERNAME: "admin", COURTSIDE_RESTORE_PASSWORD:
          readFileSync(join(installation, "secrets", "bootstrap-admin-password"), "utf8").trim() } });
      const root = join(backup, "release");
      const selected = YAML.parse(readFileSync(join(root, "compose.stalwart.yaml"), "utf8")).services.mail.image;
      const name = `${project}-restore-${index}`;
      const pair = ["config", "data"].map((kind) => `${project}_restore-${index}-${kind}`);
      restoredVolumes.push(...pair);
      for (const [position, kind] of ["config", "data"].entries()) {
        run("docker", ["volume", "create", "--label", `com.docker.compose.project=${project}`, pair[position]]);
        const helper = YAML.parse(readFileSync(join(root, "compose.stalwart.yaml"), "utf8")).services["mail-plan"].image;
        run("docker", ["run", "--rm", "-i", "--network", "none", "-v", `${pair[position]}:/target`, helper, "tar", "-C", "/target", "-xf", "-"], { input: readFileSync(join(backup, `mail-${kind}.tar`)), binary: true });
      }
      run("docker", ["run", "-d", "--name", name, "--label", `com.docker.compose.project=${project}`,
        "-p", "127.0.0.1::8080", "-e", "STALWART_RECOVERY_ADMIN", "-v", `${pair[0]}:/etc/stalwart`, "-v", `${pair[1]}:/var/lib/stalwart`,
        "-v", `${project}_mail-tls:/etc/stalwart/tls:ro`, selected], { env: { ...process.env,
          STALWART_RECOVERY_ADMIN: `admin:${environmentValue(installation, "COURTSIDE_MAIL_SETUP_PASSWORD")}` } });
      restoredContainers.push(name);
      const restorePort = run("docker", ["port", name, "8080"]).stdout.trim().split(":").at(-1);
      await until("restored mail registry", async () => {
        const response = await fetch(`http://127.0.0.1:${restorePort}/jmap`, { method: "POST", headers: {
          "content-type": "application/json", authorization: `Basic ${Buffer.from(`admin:${environmentValue(installation, "COURTSIDE_MAIL_SETUP_PASSWORD")}`).toString("base64")}` },
          body: JSON.stringify({ using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"], methodCalls: [["x:SystemSettings/get", {}, "r0"]] }) });
        return (await response.json()).methodResponses?.[0]?.[0] === "x:SystemSettings/get";
      });
      const sentinel = run("docker", ["exec", name, "cat", "/var/lib/stalwart/transition-sentinel"]).stdout;
      assert.equal(sentinel, selected.includes(":v0.16.27@") ? "source-store" : "target-store");
    }
    mkdirSync(evidence, { recursive: true });
    writeFileSync(join(evidence, "result.json"), `${JSON.stringify({ status: "passed", sourceRevision,
      sourceImage: YAML.parse(readFileSync(join(source, "compose.stalwart.yaml"), "utf8")).services.mail.image,
      targetImage: YAML.parse(readFileSync(join(candidate, "compose.stalwart.yaml"), "utf8")).services.mail.image,
      runtimeImage: image, head: run("git", ["rev-parse", "HEAD"]).stdout.trim(),
      networkFixtureOnly: true, preserved: ["booking", "allocation", "account", "persistent-key-files"],
      interruptedActivationResumed: true, restoredApplicationUnits: units.length,
      restoredMailStores: units.length, controlledMessages: 1 }, null, 2)}\n`);
    passed = true;
    process.stdout.write("Stalwart transition, controlled delivery and both real mail restores passed.\n");
  } catch (error) {
    if (existsSync(join(installation, "config", ".env"))) {
      const logs = compose(candidate, ["--profile", "*", "logs", "--no-color", "mail"], { allowFailure: true });
      writeFileSync(join(scratch, "mail.log"), `${logs.stdout}${logs.stderr}`, { mode: 0o600 });
    }
    writeFileSync(join(scratch, "failure.txt"), `${stage}\n${error.stack}\n${error.detail ?? ""}`, { mode: 0o600 });
    process.stderr.write(`Stalwart transition failed during ${stage}. Private evidence: ${scratch}\n`);
    throw new Error(`Stalwart transition qualification failed during ${stage}`);
  } finally {
    for (const name of [...restoredContainers, `${project}-sink`]) run("docker", ["rm", "-f", name], { allowFailure: true });
    if (existsSync(join(installation, "config", ".env"))) compose(candidate, ["--profile", "*", "down", "--remove-orphans"], { allowFailure: true });
    const names = run("docker", ["volume", "ls", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.Name}}"], { allowFailure: true }).stdout.trim().split("\n").filter(Boolean);
    for (const name of new Set([...names, ...restoredVolumes])) {
      const inspected = run("docker", ["volume", "inspect", name], { allowFailure: true });
      if (inspected.status === 0 && canRemoveQualificationVolume(name, JSON.parse(inspected.stdout)[0].Labels, project)) {
        run("docker", ["volume", "rm", name], { allowFailure: true });
      }
    }
    const networks = run("docker", ["network", "ls", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}}"], { allowFailure: true }).stdout.trim().split("\n").filter(Boolean);
    for (const identifier of networks) {
      const inspected = run("docker", ["network", "inspect", identifier], { allowFailure: true });
      if (inspected.status === 0) {
        const network = JSON.parse(inspected.stdout)[0];
        if (network.Labels?.["com.docker.compose.project"] === project && Object.keys(network.Containers ?? {}).length === 0) {
          run("docker", ["network", "rm", identifier], { allowFailure: true });
        }
      }
    }
    if (passed) {
      run("chmod", ["-R", "u+w", scratch], { allowFailure: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) execute().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
