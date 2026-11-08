import { useCallback, useEffect, useRef, useState } from "react";
import type { CreditLedgerPage, CreditPageOptions } from "../api/client";

export type CreditPageLoader = (options: CreditPageOptions) => Promise<CreditLedgerPage>;

export interface CreditLedgerState {
  page?: CreditLedgerPage;
  failure?: unknown;
  loadingMore: boolean;
  more: () => void;
  reload: () => Promise<void>;
}

export function useCreditLedger(load: CreditPageLoader | undefined): CreditLedgerState {
  const [page, setPage] = useState<CreditLedgerPage>();
  const [failure, setFailure] = useState<unknown>();
  const [loadingMore, setLoadingMore] = useState(false);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    if (!load) {
      setPage(undefined);
      setFailure(undefined);
      return;
    }
    try {
      const read = await load({});
      if (current !== generation.current) return;
      setPage(read);
      setFailure(undefined);
    } catch (caught) {
      if (current === generation.current) setFailure(caught);
    }
  }, [load]);

  useEffect(() => {
    const counter = generation;
    setPage(undefined);
    setFailure(undefined);
    void reload();
    return () => {
      counter.current++;
    };
  }, [reload]);

  const more = useCallback(() => {
    const cursor = page?.nextCursor;
    if (!load || !cursor || loadingMore) return;
    const current = generation.current;
    setLoadingMore(true);
    load({ cursor }).then((next) => {
      if (current !== generation.current) return;
      setPage((shown) => shown && { ...shown, items: [...shown.items, ...next.items], nextCursor: next.nextCursor });
      setFailure(undefined);
    }, (caught: unknown) => {
      if (current === generation.current) setFailure(caught);
    }).finally(() => setLoadingMore(false));
  }, [load, loadingMore, page?.nextCursor]);

  return { page, failure, loadingMore, more, reload };
}
