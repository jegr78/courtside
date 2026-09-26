import { useEffect, useState } from "react";
import { useReportedFailure } from "../../failures/useReportedFailure";
import { useRetry } from "../../failures/useRetry";
import type { Period } from "./period";

export interface Read<T> {
  value?: T;
  error?: string;
  retry: () => void;
}

export function useStatisticsRead<T>(read: (period?: Period) => Promise<T>, from?: string, to?: string): Read<T> {
  const { message: error, report, clear } = useReportedFailure();
  const [value, setValue] = useState<T>();
  const [attempt, retry] = useRetry();

  useEffect(() => {
    let active = true;
    void read(from !== undefined && to !== undefined ? { from, to } : undefined)
      .then((result) => { if (active) setValue(result); })
      .catch((failure: unknown) => { if (active) report(failure); });
    return () => { active = false; };
  }, [attempt, read, from, to, report]);

  return { value, error, retry: () => { clear(); retry(); } };
}
