export const regularBrowserProjectGroups = {
  visual: ["visual", "guides-de", "guides-en"],
  functional: ["chromium", "webkit-core", "webkit-pwa", "journey-gate"],
  "phone-iphone": ["iphone"],
  "phone-android": ["android"],
  "chromium-accessibility": ["chromium-accessibility"],
  "webkit-accessibility": ["webkit-accessibility"]
} as const;

// Playwright shards by file while fullyParallel is off, so a count needs files to divide.
export const browserGroupShards = {
  functional: 3,
  "chromium-accessibility": 2,
  "webkit-accessibility": 2
} as const;

type NamedProject = { name: string };

export function browserShard(group: string, value: string | undefined): { current: number; total: number } | undefined {
  if (value === undefined || value === "") return undefined;
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value);
  const current = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || current > total) throw new Error(`${value} is not a shard of browser project group ${group}`);
  if (browserGroupShards[group as keyof typeof browserGroupShards] !== total) {
    throw new Error(`Browser project group ${group} does not have ${total} shards`);
  }
  return { current, total };
}

export function browserProjectGroup<T extends NamedProject>(projects: T[], group: string | undefined): T[] {
  if (group === undefined) return projects;
  if (!Object.hasOwn(regularBrowserProjectGroups, group)) {
    throw new Error(`Unsupported browser project group: ${group}`);
  }
  const names = new Set<string>(
    regularBrowserProjectGroups[group as keyof typeof regularBrowserProjectGroups]);
  const selected = projects.filter(({ name }) => names.has(name));
  if (selected.length !== names.size) {
    throw new Error(`Browser project group ${group} does not match the configured projects`);
  }
  return selected;
}
