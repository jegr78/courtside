function problemOf(response) {
  try {
    const body = response.json();
    return body !== null && typeof body === "object" ? body : undefined;
  } catch {
    return undefined;
  }
}

export function problemParts(problem) {
  const parts = [problem.type ?? "without a problem type"];
  if (Array.isArray(problem.violations)) parts.push(`violations=${problem.violations.map((violation) => violation.code).join(",")}`);
  if (Array.isArray(problem.fieldErrors)) parts.push(`fields=${problem.fieldErrors.map((error) => `${error.field}:${error.code}`).join(",")}`);
  if (problem.traceId) parts.push(`traceId=${problem.traceId}`);
  return parts;
}

export function outcomeSignature(requestKey, response) {
  if (response.status === 0) return `${requestKey} 0 ${response.error_code}`;
  return `${requestKey} ${response.status} ${problemOf(response)?.type ?? "-"}`;
}

export function unexpectedOutcome(requestKey, response) {
  const prefix = `${requestKey} returned unexpected status ${response.status}`;
  if (response.status === 0) return `${prefix} error_code=${response.error_code} ${response.error}`;
  const problem = problemOf(response);
  if (!problem) return `${prefix} without a readable problem body`;
  return [prefix, ...problemParts(problem)].join(" ");
}

export function checkOutcomes(group) {
  return [
    ...(group.checks ?? []).map((check) => ({ path: check.path, passes: check.passes, fails: check.fails })),
    ...(group.groups ?? []).flatMap(checkOutcomes)
  ];
}
