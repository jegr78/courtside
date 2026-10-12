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

export function schemathesisScannerFiles(policy, client, { reasonProjection, credentialHook }) {
  return [
    { path: "/tmp/courtside-schemathesis.toml", input: schemathesisConfiguration(policy) },
    { path: "/tmp/courtside-credentials.json", input: schemathesisCredentials(client) },
    { path: "/tmp/sitecustomize.py", input: reasonProjection },
    { path: "/tmp/schemathesis_credentials.py", input: credentialHook }];
}

export function schemathesisRunArgs(scanner, policy, mode, operationIds) {
  return ["exec", "-e", "PYTHONPATH=/tmp", "-e", "SCHEMATHESIS_HOOKS=schemathesis_credentials", scanner,
    "st", "--config-file", "/tmp/courtside-schemathesis.toml", "run",
    "/schema/openapi.yaml", "--url", "http://scanner-gateway:8090", "--phases", policy.phases.join(","),
    "--mode", mode,
    "--max-examples", String(policy.maxExamples), "--workers", String(policy.workers),
    "--seed", String(policy.seed), "--request-timeout", String(policy.requestTimeoutSeconds),
    "--request-retries", "0", "--max-redirects", "0", "--max-failures", String(policy.maxFailures),
    "--checks", policy.checks.join(","), "--report", "ndjson", "--report-dir", `/tmp/courtside-schemathesis-${mode}`,
    "--output-sanitize", "true", "--output-truncate", "true", "--generation-database", ":memory:", "--no-color",
    ...operationIds.flatMap((operationId) => ["--include-operation-id", operationId])];
}
