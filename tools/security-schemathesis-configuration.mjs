export function schemathesisConfiguration(client, policy) {
  return `headers = { Cookie = ${JSON.stringify(client.header())}, X-XSRF-TOKEN = ${JSON.stringify(client.csrfToken())} }\n`
    + `rate-limit = ${JSON.stringify(policy.rateLimit)}\n`
    + `\n[phases.coverage]\nunexpected-methods = ${JSON.stringify(policy.unexpectedMethods)}\n`
    + Object.entries(policy.expectedStatuses).map(([check, statuses]) =>
      `\n[checks.${check}]\nexpected-statuses = ${JSON.stringify(statuses)}\n`).join("");
}
