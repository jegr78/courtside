export type BrowserIsolationVariant = "project" | "test";

export function browserIsolationVariant(value = process.env.COURTSIDE_WEBKIT_BROWSER_ISOLATION): BrowserIsolationVariant {
  if (value === undefined || value === "project") return "project";
  if (value === "test") return "test";
  throw new Error(`Unsupported WebKit browser isolation: ${value}`);
}

export function browserFixtureScope(variant: BrowserIsolationVariant): "worker" | "test" {
  return variant === "project" ? "worker" : "test";
}
