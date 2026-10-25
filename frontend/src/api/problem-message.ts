import type { TFunction } from "i18next";
import i18n from "../i18n";
import { formatClockTime } from "../time/clubZone";
import { ApiError, type Problem } from "./client";

const TYPE_PREFIX = "urn:courtside:error:";
// A default no bundle carries, so a missing key is told apart from a translation.
const MISSING = "\u0000missing";
const clockTimeParams = ["earliestStart", "latestEnd", "opensAt", "closesAt"];

export function isUnauthenticated(failure: unknown): boolean {
  return failure instanceof ApiError && failure.problem?.type === `${TYPE_PREFIX}unauthenticated`;
}

export function problemMessage(failure: unknown, t: TFunction): string {
  const message = problemText(failure, t);
  return isCorrectableRefusal(failure, t) ? message : withReference(failure, message, t);
}

export function problemText(failure: unknown, t: TFunction): string {
  if (!(failure instanceof ApiError) || !failure.problem) return t("error.generic");
  return translatedProblem(failure.problem, t);
}

export function withReference(failure: unknown, message: string, t: TFunction): string {
  const reference = failureReference(failure);
  if (!reference) return message;
  return message ? t("error.withReference", { message, reference }) : t("error.reference", { reference });
}

export function failureReference(failure: unknown): string | undefined {
  if (!(failure instanceof ApiError) || !failure.problem?.traceId) return undefined;
  const { traceId, spanId } = failure.problem;
  return spanId ? `${traceId}/${spanId}` : traceId;
}

export function violationMessage(code: string, params: Record<string, unknown>, t: (key: string, options?: Record<string, unknown>) => string): string {
  const message = t(code, { ...params, ...clockTimes(params), defaultValue: MISSING });
  if (message !== MISSING) return message;
  const unknown = t("error.unknownViolation");
  return import.meta.env.DEV ? `${unknown} [${code}]` : unknown;
}

function clockTimes(params: Record<string, unknown>): Record<string, string> {
  const locale = i18n.resolvedLanguage ?? i18n.language;
  return Object.fromEntries(clockTimeParams.filter((name) => typeof params[name] === "string")
    .map((name) => [name, formatClockTime(params[name] as string, locale)]));
}

// A refusal this client explains is the user's to correct, unless it says the page itself sent it wrongly.
function isCorrectableRefusal(failure: unknown, t: TFunction): boolean {
  if (!(failure instanceof ApiError) || !failure.problem || failure.status >= 500) return false;
  const coded = firstCodedFailure(failure.problem);
  if (coded) return t(coded.code, { defaultValue: MISSING }) !== MISSING;
  const slug = problemSlug(failure.problem);
  if (slug === undefined) return false;
  const message = t(`error.type.${slug}`, { defaultValue: MISSING });
  return message !== MISSING && message !== t("error.pageDefect");
}

function problemSlug(problem: Problem): string | undefined {
  return problem.type?.startsWith(TYPE_PREFIX) ? problem.type.slice(TYPE_PREFIX.length) : undefined;
}

function translatedProblem(problem: Problem, t: TFunction): string {
  const coded = firstCodedFailure(problem);
  if (coded) return violationMessage(coded.code, coded.params, t);
  const slug = problemSlug(problem);
  const message = slug ? t(`error.type.${slug}`, { defaultValue: MISSING }) : MISSING;
  return message === MISSING ? t("error.generic") : message;
}

function firstCodedFailure(problem: Problem): { code: string; params: Record<string, unknown> } | undefined {
  const failure = problem.violations?.[0] ?? problem.fieldErrors?.[0];
  return failure ? { code: failure.code, params: failure.params } : undefined;
}
