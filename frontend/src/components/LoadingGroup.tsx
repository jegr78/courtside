import { createContext, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type Pending = (change: 1 | -1) => void;

const PendingContext = createContext<Pending | undefined>(undefined);

function usePending(active: boolean) {
  const pending = useContext(PendingContext);
  useLayoutEffect(() => {
    if (!pending || !active) return;
    pending(1);
    return () => pending(-1);
  }, [pending, active]);
}

const PATIENCE_MS = 5_000;

// A status that unmounts while the next one mounts in the same commit must not count as quiet.
function useCount(quiet: (isQuiet: boolean) => void): Pending {
  const count = useRef(0);
  const patience = useRef<ReturnType<typeof setTimeout>>(undefined);
  const gaveUp = useRef(false);
  const check = useCallback(() => queueMicrotask(() => {
    if (count.current === 0) {
      clearTimeout(patience.current);
      patience.current = undefined;
      gaveUp.current = false;
      quiet(true);
      return;
    }
    // A read that hangs must not keep everything else hidden.
    patience.current ??= setTimeout(() => {
      gaveUp.current = true;
      quiet(true);
    }, PATIENCE_MS);
    if (!gaveUp.current) quiet(false);
  }), [quiet]);
  useLayoutEffect(() => {
    check();
    return () => clearTimeout(patience.current);
  }, [check]);
  return useCallback((change) => {
    count.current += change;
    check();
  }, [check]);
}

/** A loading line that keeps the nearest {@link LoadingGroup} or {@link LoadingTracker} busy while it is mounted. */
export function LoadingStatus({ className }: { className?: string }) {
  const { t } = useTranslation();
  usePending(true);
  return <p role="status" className={className}>{t("status.loading")}</p>;
}

/** Reports whether any {@link LoadingStatus} inside it is mounted. */
export function LoadingTracker({ quiet, children }: { quiet: (isQuiet: boolean) => void; children: ReactNode }) {
  const pending = useCount(quiet);
  return <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>;
}

/**
 * Shows its content once no {@link LoadingStatus} inside it is mounted, and never hides it again,
 * so sections that load separately appear together instead of pushing each other down.
 */
export function LoadingGroup({ testId, className, revealed, children }: {
  testId: string; className?: string; revealed?: () => void; children: ReactNode;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown) revealed?.();
  }, [shown, revealed]);
  const reveal = useCallback((isQuiet: boolean) => {
    if (isQuiet) setShown(true);
  }, []);
  const pending = useCount(reveal);
  usePending(!shown);

  return <PendingContext.Provider value={shown ? undefined : pending}>
    <div className={`relative ${className ?? ""}`}>
      {!shown && <p data-testid={`${testId}-loading`} role="status" className="absolute inset-x-0 top-0">{t("status.loading")}</p>}
      <div data-testid={`${testId}-content`} aria-hidden={shown ? undefined : true} className={shown ? "contents" : "invisible contents"}>
        {children}
      </div>
    </div>
  </PendingContext.Provider>;
}
