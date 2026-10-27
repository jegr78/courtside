import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

export function validateMfaMaintenance(options) {
  if (options.action === "mfa-rotate-keys") {
    if (options.accountId || options.identityChecked || options.emailFile) throw new Error("Key rotation accepts no account or email options");
    return;
  }
  if (!/^mfa-(?:recover|correct-email)$/.test(options.action)) throw new Error("Unknown MFA maintenance action");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.accountId ?? "")) throw new Error("MFA maintenance requires --account-id <UUID>");
  if (!options.identityChecked) throw new Error("MFA maintenance requires --identity-checked after an external identity check");
  if (options.action === "mfa-correct-email" && !options.emailFile) throw new Error("Email correction requires --email-file <private-file>");
  if (options.action === "mfa-recover" && options.emailFile) throw new Error("Account recovery accepts no email file");
}

function requireTrustedEmailParents(file, owner, filesystem) {
  const lexical = dirname(file);
  const real = filesystem.realpathSync(lexical);
  for (const start of new Set([lexical, real])) {
    let directory = start;
    let child;
    while (true) {
      const info = filesystem.lstatSync(directory);
      if (![0, owner].includes(info.uid) || (!info.isDirectory() && !info.isSymbolicLink())) throw new Error();
      if (info.isDirectory() && (info.mode & 0o022) !== 0) {
        const protectedByStickyParent = info.uid === 0 && (info.mode & 0o1000) !== 0
          && child?.isDirectory() && child.uid === owner && (child.mode & 0o077) === 0;
        if (!protectedByStickyParent) throw new Error();
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      child = info;
      directory = parent;
    }
  }
}

export function openMaintenanceEmail(file, runtime = {}) {
  if (typeof process.getuid !== "function" || !constants.O_NOFOLLOW) {
    throw new Error("Secure email input requires POSIX file ownership and no-follow support; use the server launcher");
  }
  const filesystem = { openSync, closeSync, fstatSync, lstatSync, realpathSync, ...runtime };
  const owner = process.getuid();
  let descriptor;
  try {
    const absolute = isAbsolute(file) ? file : `${process.cwd()}/${file}`;
    requireTrustedEmailParents(absolute, owner, filesystem);
    descriptor = filesystem.openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = filesystem.fstatSync(descriptor);
    if (!info.isFile() || info.uid !== owner || (info.mode & 0o7777) !== 0o600 || info.nlink !== 1 || info.size < 1 || info.size > 255) throw new Error();
    requireTrustedEmailParents(absolute, owner, filesystem);
    return descriptor;
  } catch {
    if (descriptor !== undefined) filesystem.closeSync(descriptor);
    throw new Error("Email input must be a private operator-owned regular file in a trusted directory, at most 254 UTF-8 bytes and an optional final newline");
  }
}

export function mfaMaintenancePlan(options, compose, environment, input) {
  validateMfaMaintenance(options);
  const arguments_ = [`--courtside.maintenance.action=${options.action}`,
    ...(options.accountId ? [`--courtside.maintenance.account-id=${options.accountId}`, "--courtside.maintenance.identity-checked=true"] : [])];
  if (options.action === "mfa-correct-email") {
    const script = `umask 077; mkdir -p /tmp/courtside-maintenance; cat > /tmp/courtside-maintenance/email; exec java --sun-misc-unsafe-memory-access=deny -XX:MaxRAMPercentage=50.0 -XX:+ExitOnOutOfMemoryError -XX:TieredStopAtLevel=1 org.springframework.boot.loader.launch.JarLauncher "$@"`;
    return { command: "docker", args: [...compose, "run", "--rm", "--no-deps", "-T", "--entrypoint", "/bin/sh", "app", "-ec", script, "courtside-maintenance", ...arguments_, "--courtside.maintenance.email-file=/tmp/courtside-maintenance/email"], environment, stdin: input };
  }
  return { command: "docker", args: [...compose, "run", "--rm", "--no-deps", "-T", "app", ...arguments_], environment };
}
