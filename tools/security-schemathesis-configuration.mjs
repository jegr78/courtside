export function schemathesisConfiguration(policy) {
  return `rate-limit = ${JSON.stringify(policy.rateLimit)}\n`
    + `\n[phases.coverage]\nunexpected-methods = ${JSON.stringify(policy.unexpectedMethods)}\n`
    + Object.entries(policy.expectedStatuses).map(([check, statuses]) =>
      `\n[checks.${check}]\nexpected-statuses = ${JSON.stringify(statuses)}\n`).join("");
}

export function schemathesisCredentials(client) {
  const credentials = { session: client.cookie("__Host-SESSION"), csrfCookie: client.cookie("__Host-XSRF-TOKEN"),
    csrfToken: client.csrfToken() };
  for (const [name, value] of Object.entries(credentials)) {
    if (typeof value !== "string" || value === "") throw new Error(`The fuzz client holds no ${name} credential`);
  }
  return JSON.stringify(credentials);
}
