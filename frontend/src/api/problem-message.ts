import type { TFunction } from "i18next";
import { ApiError, type Problem } from "./client";

const TYPE_PREFIX = "urn:courtside:error:";
// A default no bundle carries, so a missing key is told apart from a translation.
const MISSING = "\u0000missing";

export function isUnauthenticated(failure: unknown): boolean {
  return failure instanceof ApiError && failure.problem?.type === `${TYPE_PREFIX}unauthenticated`;
}

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

export function violationMessage(code: string, params: Record<string, unknown>, t: (key: string, options?: Record<string, unknown>) => string): string {
  const message = t(code, { ...params, defaultValue: MISSING });
  if (message !== MISSING) return message;
  const unknown = t("error.unknownViolation");
  return import.meta.env.DEV ? `${unknown} [${code}]` : unknown;
}

function translatedProblem(problem: Problem, t: TFunction): string {
  const coded = firstCodedFailure(problem);
  if (coded) return violationMessage(coded.code, coded.params, t);
  const slug = problem.type?.startsWith(TYPE_PREFIX) ? problem.type.slice(TYPE_PREFIX.length) : undefined;
  const message = slug ? t(`error.type.${slug}`, { defaultValue: MISSING }) : MISSING;
  return message === MISSING ? t("error.generic") : message;
}

function firstCodedFailure(problem: Problem): { code: string; params: Record<string, unknown> } | undefined {
  const failure = problem.violations?.[0] ?? problem.fieldErrors?.[0];
  return failure ? { code: failure.code, params: failure.params } : undefined;
}
