import { useTranslation } from "react-i18next";
import { useUnsavedMark } from "./registry";

// Registering the section and showing it are the same element, so a section the guard counts is
// always one the board can see.
export function UnsavedMark({ id, unsaved }: { id: string; unsaved: boolean }) {
  const { t } = useTranslation();
  useUnsavedMark(id, unsaved);
  if (!unsaved) return null;
  return <span data-testid={`unsaved-mark-${id}`} className="text-muted self-center text-sm font-medium">
    {t("unsaved.mark")}
  </span>;
}
