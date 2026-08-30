import { useTranslation } from "react-i18next";
import { markId } from "./markId";
import { useUnsavedMark } from "./registry";

// A row that is unsaved looks exactly like one that is not, so the section registers and says so
// through the same element. A creation form carries its own evidence: what somebody typed into it.
export function UnsavedMark({ id, unsaved }: { id: string; unsaved: boolean }) {
  const { t } = useTranslation();
  useUnsavedMark(id, unsaved);
  if (!unsaved) return null;
  return <span id={markId(id)} data-testid={markId(id)} className="text-muted self-center text-sm font-medium">
    {t("unsaved.mark")}
  </span>;
}
