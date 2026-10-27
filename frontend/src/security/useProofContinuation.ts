import { useCallback, useContext, useLayoutEffect, useRef } from "react";
import { ProofOwnerContext } from "./reauthentication";

export function useProofContinuation(scope?: string) {
  const owner = useContext(ProofOwnerContext);
  const version = useRef(0);
  const cancel = useCallback(() => { version.current += 1; }, []);
  const begin = useCallback(() => {
    const proof = ++version.current;
    return () => version.current === proof;
  }, []);
  useLayoutEffect(() => cancel, [cancel, owner, scope]);
  return { begin, cancel };
}
