export function restoreCommand(status) {
  const site = Object.keys(status?.Web ?? {}).find((key) => key.endsWith(":443"));
  const target = site && status.Web[site].Handlers?.["/"]?.Proxy;
  if (!target) throw new Error("the serve status has no HTTPS handler on port 443 to take down");
  return ["tailscale", status.AllowFunnel?.[site] ? "funnel" : "serve", "--bg", "--https=443", target];
}

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;

export const sameServeConfiguration = (before, after) => JSON.stringify(canonical(before)) === JSON.stringify(canonical(after));
