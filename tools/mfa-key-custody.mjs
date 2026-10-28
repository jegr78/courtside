import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const keyRoot = "/var/lib/courtside/mfa-keys";
function privateRecovery(action) {
  const directory = mkdtempSync(join(tmpdir(), "courtside-uat-restore-"));
  chmodSync(directory, 0o700);
  try { return action(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

function openRecoverySource(file) {
  const input = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(input, { bigint: true });
    verifyRecoveryEntry(file, opened);
    return { input, metadata: opened };
  } catch (failure) {
    closeSync(input);
    throw failure;
  }
}

function verifyRecoveryEntry(file, opened) {
  const entry = lstatSync(file, { bigint: true });
  if (entry.isSymbolicLink() || opened.dev !== entry.dev || opened.ino !== entry.ino) {
    throw new Error("MFA recovery source must not be a symbolic link or change while opening");
  }
}

function unchangedSource(before, after) {
  if (["dev", "ino", "size", "mtimeNs", "ctimeNs"].some((field) => before[field] !== after[field])) {
    throw new Error("MFA recovery source changed while being captured");
  }
}

function copyRecoverySource(input, destination) {
  const before = fstatSync(input, { bigint: true });
  if (!before.isFile()) throw new Error("MFA recovery input must be a regular file");
  const output = openSync(destination, "wx", 0o600);
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let remaining = before.size;
    while (remaining > 0n) {
      const length = Number(remaining > BigInt(buffer.length) ? BigInt(buffer.length) : remaining);
      const count = readSync(input, buffer, 0, length, null);
      if (count === 0) throw new Error("MFA recovery source changed while being captured");
      for (let written = 0; written < count;) written += writeSync(output, buffer, written, count - written);
      remaining -= BigInt(count);
    }
    unchangedSource(before, fstatSync(input, { bigint: true }));
  } finally {
    closeSync(output);
  }
}

function captureRecoveryFile(source, destination) {
  const opened = openRecoverySource(source);
  try {
    copyRecoverySource(opened.input, destination);
    verifyRecoveryEntry(source, opened.metadata);
  } finally { closeSync(opened.input); }
}

function withCapturedKeyArchive(source, action) {
  return privateRecovery((directory) => {
    const keys = join(directory, "mfa-keys.tar");
    captureRecoveryFile(source, keys);
    return action(keys);
  });
}

export function verifyMfaKeyArchive(file, execute = execFileSync) {
  return withCapturedKeyArchive(file, (keys) => verifyCapturedKeyArchive(keys, execute));
}

function verifyCapturedKeyArchive(file, execute = execFileSync) {
  const options = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  const entries = execute("tar", ["-tf", file], options).split("\n").filter(Boolean);
  let provided = false;
  let standard = false;
  for (const entry of entries) {
    if ([".", "./"].includes(entry)) continue;
    if (["./provided/", "./provided/mfa.keys"].includes(entry)) {
      provided = true;
    } else if (/^\.\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(mfa\.keys)?$/.test(entry)) {
      standard = true;
    } else {
      throw new Error("MFA key archive contains an unexpected path");
    }
  }
  if (provided && standard) throw new Error("MFA key archive must not mix operator-provided and installation keyrings");
  const types = execute("tar", ["-tvf", file], options).split("\n").filter(Boolean).map((entry) => entry[0]);
  if (types.some((type) => !["-", "d"].includes(type))) throw new Error("MFA key archive may contain only regular files and directories");
  return entries.includes("./provided/mfa.keys") ? "provided" : "standard";
}

export function mfaRestoreEnvironment(keys, environment) {
  return restoreEnvironmentForMode(verifyMfaKeyArchive(keys), environment);
}

function restoreEnvironmentForMode(mode, environment) {
  const provided = mode === "provided";
  const file = provided ? environment.COURTSIDE_UAT_MFA_KEY_FILE || `${keyRoot}/provided/mfa.keys` : "";
  if (!provided && environment.COURTSIDE_UAT_MFA_KEY_FILE) throw new Error("The target uses an operator-provided MFA keyfile but this archive uses installation key directories");
  return { ...environment, COURTSIDE_UAT_MFA_KEY_FILE: file, COURTSIDE_RECOVERY_MFA_KEY_FILE: provided ? `${keyRoot}/provided/mfa.keys` : "" };
}

export function exportMfaKeys(destination, compose, environment, execute) {
  const output = openSync(destination, "wx", 0o600);
  try {
    execute({ command: "docker", args: [...compose, "-f", join(root, "deploy", "compose.key-export.yaml"), "run", "--rm", "--no-deps", "-T", "--entrypoint", "/bin/sh", "app", "-ec",
      `if test -n "\${COURTSIDE_MFA_KEY_FILE:-}"; then test -f "$COURTSIDE_MFA_KEY_FILE" && test ! -L "$COURTSIDE_MFA_KEY_FILE" || { echo 'MFA keyfile must be a regular file' >&2; exit 2; }; tar --transform='s|^[^/]*$|./provided/mfa.keys|' -C "$(dirname "$COURTSIDE_MFA_KEY_FILE")" -cf - "$(basename "$COURTSIDE_MFA_KEY_FILE")"; else tar --exclude='*.lock' --exclude='.mfa-*.keys' -C "$COURTSIDE_MFA_KEY_ROOT" -cf - .; fi`], environment, stdout: output });
  } finally {
    closeSync(output);
  }
  verifyMfaKeyArchive(destination);
}

export function importMfaKeys(source, compose, environment, execute) {
  return withCapturedKeyArchive(source, (keys) => importCapturedKeys(keys, compose, environment, execute));
}

function importCapturedKeys(source, compose, environment, execute) {
  const mode = verifyCapturedKeyArchive(source);
  const input = openSync(source, "r");
  const restore = mode === "provided"
    ? `destination="$COURTSIDE_MFA_KEY_FILE"; test -n "$destination"; mkdir -p "$(dirname "$destination")"; if test -e "$destination"; then tar -xOf "$archive" ./provided/mfa.keys | cmp -s - "$destination" || { echo 'Existing MFA keyfile differs; restore into a fresh environment or supply the current retained-key archive' >&2; exit 2; }; else tar -xOf "$archive" ./provided/mfa.keys > "$destination"; chmod 600 "$destination"; fi`
    : `test -z "\${COURTSIDE_MFA_KEY_FILE:-}"; for file in $(tar -tf "$archive"); do case "$file" in */mfa.keys) if test -e "$COURTSIDE_MFA_KEY_ROOT/$file"; then tar -xOf "$archive" "$file" | cmp -s - "$COURTSIDE_MFA_KEY_ROOT/$file" || { echo 'Existing MFA keyring differs; restore into a fresh environment or supply the current retained-key archive' >&2; exit 2; }; fi;; esac; done; tar --skip-old-files --no-same-owner --no-same-permissions -C "$COURTSIDE_MFA_KEY_ROOT" -xf "$archive"; chmod -R go-rwx "$COURTSIDE_MFA_KEY_ROOT"`;
  try {
    execute({ command: "docker", args: [...compose, "run", "--rm", "--no-deps", "-T", "--entrypoint", "/bin/sh", "app", "-ec",
      `umask 077; archive=$(mktemp); trap 'rm -f "$archive"' EXIT; cat > "$archive"; ${restore}`], environment, stdin: input });
  } finally {
    closeSync(input);
  }
}

export function createUatRecovery(destination, compose, environment, execute) {
  if (existsSync(destination)) throw new Error(`Backup destination already exists: ${destination}`);
  mkdirSync(dirname(destination), { recursive: true });
  const staging = mkdtempSync(join(dirname(destination), ".uat-recovery-"));
  chmodSync(staging, 0o700);
  try {
    const output = openSync(join(staging, "database.dump"), "wx", 0o600);
    try {
      execute({ command: "docker", args: [...compose, "exec", "-T", "db", "pg_dump", "-Fc", "-U", "courtside", "courtside"], environment, stdout: output });
    } finally {
      closeSync(output);
    }
    exportMfaKeys(join(staging, "mfa-keys.tar"), compose, environment, execute);
    writeFileSync(join(staging, "restore-instructions.txt"), "Restore this complete directory with uat-restore. database.dump alone requires its matching MFA keys whenever encrypted TOTP enrollments exist.\n", { mode: 0o600 });
    renameSync(staging, destination);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function validateUatRecovery(database, keys, environment, execute) {
  return privateRecovery((directory) => {
    const capturedDatabase = join(directory, "database.dump");
    const capturedKeys = join(directory, "mfa-keys.tar");
    captureRecoveryFile(database, capturedDatabase);
    captureRecoveryFile(keys, capturedKeys);
    return validateCapturedRecovery(capturedDatabase, capturedKeys, environment, execute);
  });
}

function validateCapturedRecovery(database, keys, environment, execute) {
  const project = `courtside-uat-check-${randomBytes(8).toString("hex")}`;
  const compose = ["compose", "-p", project, "-f", join(root, "deploy/compose.recovery-check.yaml")];
  const checkEnvironment = { ...restoreEnvironmentForMode(verifyCapturedKeyArchive(keys), environment), COURTSIDE_RECOVERY_IMAGE: environment.COURTSIDE_UAT_IMAGE,
    COURTSIDE_RECOVERY_DATABASE_PASSWORD: randomBytes(24).toString("hex") };
  try {
    execute({ command: "docker", args: [...compose, "up", "-d", "--wait", "db"], environment: checkEnvironment });
    const input = openSync(database, "r");
    try {
      execute({ command: "docker", args: [...compose, "exec", "-T", "db", "pg_restore", "--no-owner", "--single-transaction", "--exit-on-error", "-U", "courtside", "-d", "courtside"], environment: checkEnvironment, stdin: input });
    } finally {
      closeSync(input);
    }
    importCapturedKeys(keys, compose, checkEnvironment, execute);
    execute({ command: "docker", args: [...compose, "up", "-d", "--wait", "app"], environment: checkEnvironment });
  } finally {
    execute({ command: "docker", args: [...compose, "down", "--volumes", "--remove-orphans"], environment: checkEnvironment });
  }
}

export function restoreUatDatabase(input, compose, environment, execute) {
  execute({ command: "docker", args: [...compose, "exec", "-T", "db", "/bin/sh", "-ec",
    `umask 077; directory=$(mktemp -d); trap 'rm -rf "$directory"' EXIT; cat > "$directory/database.dump"; pg_restore --no-owner --file="$directory/database.sql" "$directory/database.dump"; psql --single-transaction --set=ON_ERROR_STOP=1 -U courtside -d courtside --command='DROP SCHEMA public CASCADE; CREATE SCHEMA public;' --file="$directory/database.sql"`], environment, stdin: input });
}

export function restoreUatRecovery(source, compose, environment, execute) {
  return privateRecovery((directory) => {
    const originalEnvironment = environment;
    let restored = false;
    const database = join(directory, "database.dump");
    const keys = join(directory, "mfa-keys.tar");
    const opened = openRecoverySource(source);
    let complete;
    try {
      complete = opened.metadata.isDirectory();
      if (complete) {
        captureRecoveryFile(join(source, "database.dump"), database);
        captureRecoveryFile(join(source, "mfa-keys.tar"), keys);
        unchangedSource(opened.metadata, fstatSync(opened.input, { bigint: true }));
      } else copyRecoverySource(opened.input, database);
      verifyRecoveryEntry(source, opened.metadata);
    } finally {
      closeSync(opened.input);
    }
    if (!complete) exportMfaKeys(keys, compose, environment, execute);
    environment = restoreEnvironmentForMode(verifyCapturedKeyArchive(keys), environment);
    validateCapturedRecovery(database, keys, environment, execute);
    execute({ command: "docker", args: [...compose, "stop", "app"], environment });
    try {
      importCapturedKeys(keys, compose, environment, execute);
      const input = openSync(database, "r");
      try {
        restoreUatDatabase(input, compose, environment, execute);
      } finally {
        closeSync(input);
      }
      restored = true;
    } finally {
      execute({ command: "docker", args: [...compose, "up", "-d", "--wait", "app", "proxy"], environment: restored ? environment : originalEnvironment });
    }
    return environment.COURTSIDE_UAT_MFA_KEY_FILE;
  });
}
