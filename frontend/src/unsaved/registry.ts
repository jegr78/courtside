import { createContext, useContext, useEffect } from "react";

export type UnsavedChangesRegistry = {
  unsavedCount: number;
  holds: (id: string) => boolean;
  mark: (id: string, unsaved: boolean) => void;
};

export const UnsavedChangesContext = createContext<UnsavedChangesRegistry | undefined>(undefined);

export function useUnsavedChanges(): UnsavedChangesRegistry {
  const registry = useContext(UnsavedChangesContext);
  if (!registry) {
    throw new Error("Unsaved work can only be marked inside an UnsavedChangesProvider");
  }
  return registry;
}

// One entry per thing that has its own save, so the count the question shows is the number of
// saves a member would lose rather than the number of pages they happen to have open.
export function useUnsavedMark(id: string, unsaved: boolean): void {
  const { mark } = useUnsavedChanges();
  useEffect(() => {
    mark(id, unsaved);
    return () => mark(id, false);
  }, [id, mark, unsaved]);
}
