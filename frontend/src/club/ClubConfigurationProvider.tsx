import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api, type ClubConfig } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { ClubConfigurationContext } from "./registry";

export function ClubConfigurationProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [club, setClub] = useState<ClubConfig>();
  const [failure, setFailure] = useState<{ thrown: unknown }>();
  const held = useRef(false);
  const asking = useRef(false);

  // Refs rather than state, so several views mounting within one render pass cannot each walk past
  // the guard and send the same request.
  const load = useCallback(() => {
    if (held.current || asking.current) return;
    asking.current = true;
    setFailure(undefined);
    void api.config()
      .then((value) => {
        held.current = true;
        setClub(value);
      })
      .catch((thrown: unknown) => setFailure({ thrown }))
      .finally(() => {
        asking.current = false;
      });
  }, []);

  const changed = useCallback((value: ClubConfig) => {
    held.current = true;
    setClub(value);
    setFailure(undefined);
  }, []);

  // The failure is kept rather than its message, so a reader who switches language is answered in
  // the one they switched to.
  const error = failure ? problemMessage(failure.thrown, t) : undefined;
  const configuration = useMemo(() => ({ club, error, changed, load }), [club, error, changed, load]);
  return <ClubConfigurationContext value={configuration}>{children}</ClubConfigurationContext>;
}
