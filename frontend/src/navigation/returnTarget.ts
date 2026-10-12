const RETURN_PARAMETER = "returnTo";
const MAX_DECODING_LAYERS = 4;
const SIGN_IN_STEPS = new Set(["/login", "/initial-password", "/account-recovery"]);

interface Address {
  pathname: string;
  search: string;
  hash: string;
}

function controlCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

function withoutControlCharacters(text: string): boolean {
  return ![...text].some(controlCharacter);
}

// Browsers drop tabs and newlines and read a backslash as a slash; NFKC folds fullwidth lookalikes into both.
function plainPath(path: string): boolean {
  return [path, path.normalize("NFKC")].every((form) => form.startsWith("/") && !form.startsWith("//")
    && !form.includes("\\") && withoutControlCharacters(form)
    && !form.split("/").some((segment) => segment === "." || segment === ".."));
}

function decoded(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}

function safePath(path: string): boolean {
  let layer = path;
  for (let depth = 0; depth < MAX_DECODING_LAYERS; depth++) {
    if (!plainPath(layer)) return false;
    const next = decoded(layer);
    if (next === undefined) return false;
    if (next === layer) return true;
    layer = next;
  }
  return false;
}

// Query and fragment cannot change the origin, so they only have to stay free of what a browser would strip.
function safeRest(rest: string): boolean {
  const once = decoded(rest);
  return once !== undefined && withoutControlCharacters(rest) && withoutControlCharacters(once);
}

/** The candidate when its path stays on this origin under every percent-decoding, otherwise undefined. */
export function returnTarget(candidate: string | null | undefined): string | undefined {
  if (!candidate) return undefined;
  const end = candidate.search(/[?#]/);
  const path = end === -1 ? candidate : candidate.slice(0, end);
  const rest = end === -1 ? "" : candidate.slice(end);
  return safePath(path) && safeRest(rest) ? candidate : undefined;
}

export function returnTargetIn(search: string): string | undefined {
  return returnTarget(new URLSearchParams(search).get(RETURN_PARAMETER));
}

function queryFor(target: string | undefined): string {
  return target ? `?${new URLSearchParams({ [RETURN_PARAMETER]: target }).toString()}` : "";
}

/** The query that carries a usable return target from one sign-in step to the next, or an empty string. */
export function returnSearch(search: string): string {
  return queryFor(returnTargetIn(search));
}

/** The query naming this address as the target, or the target it already carries when it is a sign-in step. */
export function returnQuery({ pathname, search, hash }: Address): string {
  if (SIGN_IN_STEPS.has(pathname)) return returnSearch(search);
  const target = `${pathname}${search}${hash}`;
  return target === "/" ? "" : queryFor(returnTarget(target));
}

export function signInPath(address: Address): string {
  return `/login${returnQuery(address)}`;
}

export function currentSignInPath(): string {
  return signInPath({ pathname: window.location.pathname, search: window.location.search, hash: window.location.hash });
}
