import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { problemMessage } from "./problem-message";

// Describing a failure must not change identity with the language, or every view whose load effect
// depends on it starts over whenever somebody switches it.
export function useFailureMessage(): (failure: unknown) => string {
  const { t } = useTranslation();
  const translate = useRef(t);
  useEffect(() => {
    translate.current = t;
  }, [t]);
  return useCallback((failure: unknown) => problemMessage(failure, translate.current), []);
}
