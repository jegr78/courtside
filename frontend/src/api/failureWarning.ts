import { ApiError } from "./client";

// Status and problem type only: a request body or a rendered message may carry a member's data.
export function warnAbout(context: string, failure: unknown): void {
  console.warn(`${context}: ${describe(failure)}`);
}

function describe(failure: unknown): string {
  if (failure instanceof ApiError) {
    return failure.problem?.type ? `status ${failure.status} ${failure.problem.type}` : `status ${failure.status}`;
  }
  if (failure instanceof SyntaxError) return failure.name;
  if (failure instanceof Error) return `${failure.name}: ${failure.message}`.slice(0, 200);
  return typeof failure;
}
