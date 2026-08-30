import { useCallback, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { formEdited } from "./formEdited";
import { useUnsavedChanges, useUnsavedMark } from "./registry";

export function useUnsavedForm(id: string) {
  const { mark } = useUnsavedChanges();
  const [edited, setEdited] = useState(false);
  useUnsavedMark(id, edited);

  // The blocker asks the registry the moment a route changes, and a mark set through an effect
  // would still be standing then, so a form that navigates on success clears it itself.
  const saved = useCallback(() => {
    flushSync(() => mark(id, false));
    setEdited(false);
  }, [id, mark]);

  return {
    form: {
      onInput: (event: FormEvent<HTMLFormElement>) => setEdited(formEdited(event.currentTarget)),
      onReset: () => setEdited(false)
    },
    saved
  };
}
