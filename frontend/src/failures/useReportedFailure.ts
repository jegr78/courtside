import type { TFunction } from "i18next";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { problemMessage } from "../api/problem-message";

type Describe = (failure: unknown, t: TFunction) => string | undefined;
type Reported = { failure: unknown; describe: Describe } | { message: string };

// The failure is kept, not the sentence it produced, so the text is derived at render and follows
// the language. Reporting one keeps its identity, so a load effect can depend on it and still run
// once.
export function useReportedFailure() {
  const { t } = useTranslation();
  const [reported, setReported] = useState<Reported>();

  const report = useCallback(
    (failure: unknown, describe: Describe = problemMessage) => setReported({ failure, describe }), []);
  const refuse = useCallback((message: string) => setReported({ message }), []);
  const clear = useCallback(() => setReported(undefined), []);

  const message = reported === undefined
    ? undefined
    : "message" in reported ? reported.message : reported.describe(reported.failure, t);

  return { message, report, refuse, clear };
}
