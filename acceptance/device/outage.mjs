const PLAIN_URL = /^https?:\/\/[\w.-]+(:\d+)?\/?$/;

export function restoreCommand(status) {
  const sites = Object.keys(status?.Web ?? {}).filter((key) => key.endsWith(":443"));
  if (sites.length === 0) throw new Error("the serve status has no HTTPS handler on port 443 to take down");
  const handlers = status.Web[sites[0]].Handlers ?? {};
  if (sites.length !== 1 || Object.keys(handlers).join() !== "/") throw new Error("port 443 must carry exactly one handler, on /, for the restore to bring it back");
  const target = handlers["/"].Proxy;
  if (!PLAIN_URL.test(target ?? "")) throw new Error(`the proxy target on port 443 is not a plain URL: ${target}`);
  return ["tailscale", status.AllowFunnel?.[sites[0]] ? "funnel" : "serve", "--bg", "--https=443", target];
}

const RESTORE_UNIT = "courtside-serve-restore";

export function restoreTimer(restore) {
  return {
    arm: ["systemd-run", `--unit=${RESTORE_UNIT}`, "--on-active=300", `/usr/bin/${restore[0]}`, ...restore.slice(1)],
    disarm: [["systemctl", "stop", `${RESTORE_UNIT}.timer`], ["systemctl", "reset-failed", `${RESTORE_UNIT}.service`]]
  };
}

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;

export const sameServeConfiguration = (before, after) => JSON.stringify(canonical(before)) === JSON.stringify(canonical(after));
