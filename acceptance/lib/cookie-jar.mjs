const nowSeconds = () => Math.floor(Date.now() / 1000);

function parse(line, url, now) {
  const [pair, ...attributes] = line.split(";");
  const split = pair.indexOf("=");
  const cookie = { name: pair.slice(0, split).trim(), value: pair.slice(split + 1).trim(), domain: url.hostname, path: "/", expires: -1,
    httpOnly: false, secure: false, sameSite: "Lax" };
  let gone = false;
  for (const attribute of attributes) {
    const [key, ...rest] = attribute.split("=");
    const name = key.trim().toLowerCase();
    const value = rest.join("=").trim();
    if (name === "path") cookie.path = value || "/";
    else if (name === "domain" && value) cookie.domain = `.${value.replace(/^\./, "")}`;
    else if (name === "httponly") cookie.httpOnly = true;
    else if (name === "secure") cookie.secure = true;
    else if (name === "samesite") cookie.sameSite = { strict: "Strict", none: "None" }[value.toLowerCase()] ?? "Lax";
    else if (name === "max-age") { const seconds = Number(value); gone = seconds <= 0; cookie.expires = now + seconds; }
    else if (name === "expires" && !attributes.some((other) => /^\s*max-age=/i.test(other))) {
      const at = Math.floor(Date.parse(value) / 1000);
      if (Number.isFinite(at)) { gone = at <= now; cookie.expires = at; }
    }
  }
  return { cookie, gone };
}

/** Applies an answer's Set-Cookie lines to a Playwright storage-state cookie list. */
export function applySetCookies(cookies, lines, url, now = nowSeconds()) {
  let jar = [...cookies];
  for (const line of lines) {
    const { cookie, gone } = parse(line, url, now);
    jar = jar.filter((kept) => !(kept.name === cookie.name && kept.path === cookie.path && kept.domain === cookie.domain));
    if (!gone) jar.push(cookie);
  }
  return jar;
}

const matchesHost = (domain, host) => domain.startsWith(".") ? host === domain.slice(1) || host.endsWith(domain) : host === domain;

export function cookieHeader(cookies, url, now = nowSeconds()) {
  return cookies
    .filter((cookie) => matchesHost(cookie.domain, url.hostname) && url.pathname.startsWith(cookie.path)
      && (!cookie.secure || url.protocol === "https:") && (cookie.expires < 0 || cookie.expires > now))
    .map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
