export const DISPOSABLE_PROFILES = ["desktop-firefox", "desktop-safari", "iphone-15-de"];

export function disposableFor(profile, usernames) {
  const index = DISPOSABLE_PROFILES.indexOf(profile);
  return usernames[Math.max(index, 0) % usernames.length];
}

export const profilesOf = (username, usernames) => DISPOSABLE_PROFILES.filter((profile) => disposableFor(profile, usernames) === username);

export function resetQuota({ sentAt, now, perHour, needed }) {
  const recent = sentAt.filter((at) => at > now - 3_600_000).sort((a, b) => a - b);
  const excess = recent.length + needed - perHour;
  if (excess <= 0) return { ok: true, sentInLastHour: recent.length, freeAt: null };
  return { ok: false, sentInLastHour: recent.length, freeAt: new Date(recent[excess - 1] + 3_600_000).toISOString() };
}
