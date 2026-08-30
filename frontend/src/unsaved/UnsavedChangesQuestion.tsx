import { useTranslation } from "react-i18next";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";

export function UnsavedChangesQuestion({ count, stay, discard }: {
  count: number;
  stay: () => void;
  discard: () => void;
}) {
  const { t } = useTranslation();
  return <Modal labelledBy="unsaved-changes-heading" closed={stay}>
    <div data-testid="unsaved-changes" className="surface-panel w-full max-w-md rounded-2xl border p-6 shadow-2xl">
      <h3 id="unsaved-changes-heading" className="text-xl font-bold">{t("unsaved.title")}</h3>
      <p className="mt-3">{t("unsaved.question", { count })}</p>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" type="button" data-testid="unsaved-changes-stay"
                onClick={stay}>{t("unsaved.stay")}</Button>
        <Button variant="destructive" type="button" data-testid="unsaved-changes-discard"
                onClick={discard}>{t("unsaved.discard")}</Button>
      </div>
    </div>
  </Modal>;
}
