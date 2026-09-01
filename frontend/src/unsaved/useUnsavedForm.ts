import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { formEdited } from "./formEdited";
import { useUnsavedChanges, useUnsavedMark } from "./registry";

// A control that is no form field — a chip, a swatch — is invisible to an input event, so a form
// carrying one says so itself and has the fields read again whenever that answer changes.
export function useUnsavedForm(id: string, besidesFields = false) {
  const { mark } = useUnsavedChanges();
  const [edited, setEdited] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useUnsavedMark(id, edited || besidesFields);

  useEffect(() => {
    if (form.current) setEdited(formEdited(form.current));
  }, [besidesFields]);

  // The blocker asks the registry the moment a route changes, and a mark set through an effect
  // would still be standing then, so a form that navigates on success clears it itself.
  const saved = useCallback(() => {
    flushSync(() => mark(id, false));
    setEdited(false);
  }, [id, mark]);

  return {
    form: {
      ref: form,
      onInput: (event: FormEvent<HTMLFormElement>) => setEdited(formEdited(event.currentTarget)),
      onReset: () => setEdited(false)
    },
    saved
  };
}
