import { useTranslation } from "react-i18next";
import { Button } from "../components/Button";
import { markId } from "./markId";
import { useUnsavedMark } from "./registry";

type SaveBarProps = {
  id: string;
  subject: string;
  saveTestId: string;
  unsaved: boolean;
  pending: boolean;
  discard: () => void;
} & ({ save: () => void; form?: undefined } | { form: string; save?: () => void });

// Stays mounted while clean, because it holds the page's one entry in the unsaved-changes registry.
export function SaveBar({ id, subject, saveTestId, unsaved, pending, discard, save, form }: SaveBarProps) {
  const { t } = useTranslation();
  useUnsavedMark(id, unsaved);
  if (!unsaved) return null;
  return <div data-testid="save-bar"
              className="surface-raised sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-[0_10px_30px_var(--cs-shadow)]">
    <p id={markId(id)} data-testid={markId(id)} className="min-w-0 font-medium">
      {t("unsaved.bar", { subject })}
    </p>
    <div className="flex flex-wrap gap-3">
      <Button variant="secondary" data-testid={`discard-${id}`} type="button" disabled={pending} className="py-2"
              onClick={discard}>{t("unsaved.discardChanges")}</Button>
      <Button variant="primary" data-testid={saveTestId} disabled={pending} className="py-2"
              aria-describedby={markId(id)}
              {...(form === undefined ? { type: "button", onClick: save } : { type: "submit", form })}>
        {t("admin.save")}
      </Button>
    </div>
  </div>;
}
