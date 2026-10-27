import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const keyRoot = "/var/lib/courtside/mfa-keys";
export function verifyMfaKeyArchive(file, execute = execFileSync) {
  if (!lstatSync(file).isFile()) throw new Error("MFA key archive must be a regular file");
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
  const provided = verifyMfaKeyArchive(keys) === "provided";
  const file = provided ? environment.COURTSIDE_UAT_MFA_KEY_FILE || `${keyRoot}/provided/mfa.keys` : "";
  if (!provided && environment.COURTSIDE_UAT_MFA_KEY_FILE) throw new Error("The target uses an operator-provided MFA keyfile but this archive uses installation key directories");
  return { ...environment, COURTSIDE_UAT_MFA_KEY_FILE: file, COURTSIDE_RECOVERY_MFA_KEY_FILE: provided ? `${keyRoot}/provided/mfa.keys` : "" };
}

export function exportMfaKeys(destination, compose, environment, execute) {
  const output = openSync(destination, "wx", 0o600);
  try {
    execute({ command: "docker", args: [...compose, "run", "--rm", "--no-deps", "-T", "--entrypoint", "/bin/sh", "app", "-ec",
      `if test -n "\${COURTSIDE_MFA_KEY_FILE:-}"; then test -f "$COURTSIDE_MFA_KEY_FILE" && test ! -L "$COURTSIDE_MFA_KEY_FILE" || { echo 'MFA keyfile must be a regular file' >&2; exit 2; }; tar --transform='s|^[^/]*$|./provided/mfa.keys|' -C "$(dirname "$COURTSIDE_MFA_KEY_FILE")" -cf - "$(basename "$COURTSIDE_MFA_KEY_FILE")"; else tar --exclude='*.lock' --exclude='.mfa-*.keys' -C "$COURTSIDE_MFA_KEY_ROOT" -cf - .; fi`], environment, stdout: output });
  } finally {
    closeSync(output);
  }
  verifyMfaKeyArchive(destination);
}

export function importMfaKeys(source, compose, environment, execute) {
  const mode = verifyMfaKeyArchive(source);
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
  const project = `courtside-uat-check-${randomBytes(8).toString("hex")}`;
  const compose = ["compose", "-p", project, "-f", join(root, "deploy/compose.recovery-check.yaml")];
  const checkEnvironment = { ...mfaRestoreEnvironment(keys, environment), COURTSIDE_RECOVERY_IMAGE: environment.COURTSIDE_UAT_IMAGE,
    COURTSIDE_RECOVERY_DATABASE_PASSWORD: randomBytes(24).toString("hex") };
  try {
    execute({ command: "docker", args: [...compose, "up", "-d", "--wait", "db"], environment: checkEnvironment });
    const input = openSync(database, "r");
    try {
      execute({ command: "docker", args: [...compose, "exec", "-T", "db", "pg_restore", "--no-owner", "--single-transaction", "--exit-on-error", "-U", "courtside", "-d", "courtside"], environment: checkEnvironment, stdin: input });
    } finally {
      closeSync(input);
    }
    importMfaKeys(keys, compose, checkEnvironment, execute);
    execute({ command: "docker", args: [...compose, "up", "-d", "--wait", "app"], environment: checkEnvironment });
  } finally {
    execute({ command: "docker", args: [...compose, "down", "--volumes", "--remove-orphans"], environment: checkEnvironment });
  }
}

export function restoreUatRecovery(source, compose, environment, execute) {
  const originalEnvironment = environment;
  let restored = false;
  const directory = statSync(source).isDirectory();
  const database = directory ? join(source, "database.dump") : source;
  const privateDirectory = mkdtempSync(join(tmpdir(), "courtside-uat-restore-"));
  const keys = directory ? join(source, "mfa-keys.tar") : join(privateDirectory, "mfa-keys.tar");
  try {
    if (!directory) exportMfaKeys(keys, compose, environment, execute);
    environment = mfaRestoreEnvironment(keys, environment);
    validateUatRecovery(database, keys, environment, execute);
    execute({ command: "docker", args: [...compose, "stop", "app"], environment });
    try {
      importMfaKeys(keys, compose, environment, execute);
      const input = openSync(database, "r");
      try {
        execute({ command: "docker", args: [...compose, "exec", "-T", "db", "pg_restore", "--clean", "--if-exists", "--no-owner", "--single-transaction", "--exit-on-error", "-U", "courtside", "-d", "courtside"], environment, stdin: input });
      } finally {
        closeSync(input);
      }
      restored = true;
    } finally {
      execute({ command: "docker", args: [...compose, "up", "-d", "--wait", "app", "proxy"], environment: restored ? environment : originalEnvironment });
    }
  } finally {
    rmSync(privateDirectory, { recursive: true, force: true });
  }
  return environment.COURTSIDE_UAT_MFA_KEY_FILE;
}
