import { useCallback, useMemo, useState, type ReactNode } from "react";
import { UnsavedChangesContext } from "./registry";

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [unsaved, setUnsaved] = useState<ReadonlySet<string>>(new Set());

  const mark = useCallback((id: string, unsaved: boolean) => {
    setUnsaved((current) => {
      if (current.has(id) === unsaved) return current;
      const next = new Set(current);
      if (unsaved) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const registry = useMemo(() => ({
    unsavedCount: unsaved.size,
    holds: (id: string) => unsaved.has(id),
    mark
  }), [unsaved, mark]);
  return <UnsavedChangesContext value={registry}>{children}</UnsavedChangesContext>;
}
