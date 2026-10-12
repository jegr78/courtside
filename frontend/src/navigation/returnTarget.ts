const RETURN_PARAMETER = "returnTo";
const MAX_DECODING_LAYERS = 4;

interface Address {
  pathname: string;
  search: string;
  hash: string;
}

function controlCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

// Browsers drop tabs and newlines from a URL and read a backslash as a slash, so each could turn a path into a host.
function relativePath(candidate: string): boolean {
  return candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.startsWith("/\\")
    && ![...candidate].some(controlCharacter);
}

function decoded(candidate: string): string | undefined {
  try {
    return decodeURIComponent(candidate);
  } catch {
    return undefined;
  }
}

/** The candidate when it is a relative path on this origin under every percent-decoding of it, otherwise undefined. */
export function returnTarget(candidate: string | null | undefined): string | undefined {
  if (!candidate) return undefined;
  let layer = candidate;
  for (let depth = 0; depth < MAX_DECODING_LAYERS; depth++) {
    if (!relativePath(layer)) return undefined;
    const next = decoded(layer);
    if (next === undefined) return undefined;
    if (next === layer) return candidate;
    layer = next;
  }
  return undefined;
}

export function returnTargetIn(search: string): string | undefined {
  return returnTarget(new URLSearchParams(search).get(RETURN_PARAMETER));
}

/** The query that carries a usable return target from one sign-in step to the next, or an empty string. */
export function returnSearch(search: string): string {
  const target = returnTargetIn(search);
  return target ? `?${new URLSearchParams({ [RETURN_PARAMETER]: target }).toString()}` : "";
}

export function signInPath({ pathname, search, hash }: Address): string {
  return `/login?${new URLSearchParams({ [RETURN_PARAMETER]: `${pathname}${search}${hash}` }).toString()}`;
}
