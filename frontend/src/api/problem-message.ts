import type { TFunction } from "i18next";
import { ApiError, type Problem } from "./client";

const typeMessageKeys: Record<string, string> = {
  "urn:courtside:error:unauthenticated": "auth.failed"
};

export function problemMessage(failure: unknown, t: TFunction): string {
  if (!(failure instanceof ApiError) || !failure.problem) {
    return t("error.generic");
  }
  const coded = firstCodedFailure(failure.problem);
  if (coded) {
    return t(coded.code, { ...coded.params, defaultValue: t("error.generic") });
  }
  const typeMessageKey = typeMessageKeys[failure.problem.type];
  return t(typeMessageKey ?? "error.generic");
}

function firstCodedFailure(problem: Problem): { code: string; params: Record<string, unknown> } | undefined {
  const failure = problem.violations?.[0] ?? problem.fieldErrors?.[0];
  return failure ? { code: failure.code, params: failure.params } : undefined;
}
