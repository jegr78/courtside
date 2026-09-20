export const regularBrowserProjectGroups = {
  visual: ["visual", "guides-de", "guides-en"],
  "functional-a": ["chromium", "webkit-core", "webkit-pwa"],
  "functional-b": ["chromium-accessibility", "iphone", "android", "journey-gate"]
} as const;

type NamedProject = { name: string };

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
