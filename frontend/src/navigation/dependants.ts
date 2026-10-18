import { useEffect, useReducer, useState } from "react";
import { api } from "../api/client";
import { warnAbout } from "../api/failureWarning";

const DEPENDANTS_CHANGED = "courtside:dependants-changed";

export function announceDependantsChanged() {
  window.dispatchEvent(new Event(DEPENDANTS_CHANGED));
}

// Read again on every page change, so a relationship the board ends takes the destination away.
export function useHasDependants(authenticated: boolean, pathname: string): boolean {
  const [hasDependants, setHasDependants] = useState(false);
  const [changes, changed] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    window.addEventListener(DEPENDANTS_CHANGED, changed);
    return () => window.removeEventListener(DEPENDANTS_CHANGED, changed);
  }, []);

  useEffect(() => {
    if (!authenticated) {
      setHasDependants(false);
      return;
    }
    let current = true;
    api.dependants()
      .then((dependants) => { if (current) setHasDependants(dependants.length > 0); })
      .catch((failure: unknown) => {
        if (current) setHasDependants(false);
        warnAbout("Dependants unavailable", failure);
      });
    return () => { current = false; };
  }, [authenticated, pathname, changes]);

  return authenticated && hasDependants;
}
