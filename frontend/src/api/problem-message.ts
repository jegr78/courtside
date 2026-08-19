import type { TFunction } from "i18next";
import { ApiError, type Problem } from "./client";

const typeMessageKeys: Record<string, string> = {
  "urn:courtside:error:unauthenticated": "auth.failed",
  "urn:courtside:error:court-unavailable": "booking.courtUnavailable",
  "urn:courtside:error:username-taken": "roster.usernameTaken",
  "urn:courtside:error:person-account-exists": "roster.accountExists"
};

export function problemMessage(failure: unknown, t: TFunction): string {
  if (!(failure instanceof ApiError) || !failure.problem) {
    return t("error.generic");
  }
  const message = translatedProblem(failure.problem, t);
  const reference = traceReference(failure.problem);
  return reference
    ? t("error.withReference", { message, reference })
    : message;
}

export function problemReference(failure: unknown, t: TFunction): string | undefined {
  if (!(failure instanceof ApiError) || !failure.problem?.traceId) {
    return undefined;
  }
  return t("error.reference", { reference: traceReference(failure.problem) });
}

function traceReference(problem: Problem): string | undefined {
  if (!problem.traceId) return undefined;
  return problem.spanId ? `${problem.traceId}/${problem.spanId}` : problem.traceId;
}

function translatedProblem(problem: Problem, t: TFunction): string {
  const coded = firstCodedFailure(problem);
  if (coded) {
    return t(coded.code, { ...coded.params, defaultValue: t("error.generic") });
  }
  const typeMessageKey = typeMessageKeys[problem.type];
  return t(typeMessageKey ?? "error.generic");
}

function firstCodedFailure(problem: Problem): { code: string; params: Record<string, unknown> } | undefined {
  const failure = problem.violations?.[0] ?? problem.fieldErrors?.[0];
  return failure ? { code: failure.code, params: failure.params } : undefined;
}
