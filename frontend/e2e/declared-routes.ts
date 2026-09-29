export interface DeclaredRoute {
  path: string;
  redirect: boolean;
}

function join(prefix: string, path: string): string {
  if (path.startsWith("/")) return path;
  return `${prefix.replace(/\/$/, "")}/${path}`;
}

function tagEnd(source: string, from: number): { end: number; selfClosing: boolean } {
  let depth = 0;
  for (let index = from; index < source.length; index++) {
    const character = source[index];
    if (character === "{") depth++;
    else if (character === "}") depth--;
    else if (depth === 0 && character === ">") {
      return { end: index + 1, selfClosing: source[index - 1] === "/" };
    }
  }
  throw new Error(`A <Route> tag starting at ${from} never closes`);
}

function topLevel(attributes: string): string {
  let depth = 0;
  let text = "";
  for (const character of attributes) {
    if (character === "{") depth++;
    if (depth === 0) text += character;
    if (character === "}") depth--;
  }
  return text;
}

// Reads the pages a React Router tree declares, so a guard over them cannot miss one added later.
export function declaredRoutes(source: string, base = ""): DeclaredRoute[] {
  const routes: DeclaredRoute[] = [];
  const prefixes = [base];
  for (const match of source.matchAll(/<Route\b|<\/Route>/g)) {
    const prefix = prefixes[prefixes.length - 1];
    if (match[0] === "</Route>") {
      prefixes.pop();
      continue;
    }
    const start = match.index + match[0].length;
    const { end, selfClosing } = tagEnd(source, start);
    const attributes = source.slice(start, end);
    const outside = topLevel(attributes);
    const path = /\bpath="([^"]+)"/.exec(outside)?.[1];
    if (!selfClosing) {
      prefixes.push(path === undefined ? prefix : join(prefix, path));
      continue;
    }
    if (path === "*" || path?.endsWith("/*")) continue;
    const element = /\belement=\{\s*(<\w+)?/.exec(attributes)?.[1];
    const resolved = path === undefined ? (/\bindex\b/.test(outside) ? prefix || "/" : undefined) : join(prefix, path);
    if (resolved !== undefined) routes.push({ path: resolved, redirect: element === "<Navigate" });
  }
  return routes;
}

export function routePattern(path: string): RegExp {
  return new RegExp(`^${path.replace(/:[^/]+/g, "[^/]+")}$`);
}
