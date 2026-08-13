import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Allocation } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";

export function CancellationDialog({ allocation, closed, cancelled }: { allocation: Allocation; closed: () => void; cancelled: () => Promise<void> }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string>();
  return <Modal labelledBy="cancel-heading" closed={closed}>
    <div className="surface-panel w-full max-w-md rounded-2xl border p-6 shadow-2xl">
      <h3 id="cancel-heading" className="text-xl font-bold">{t("booking.cancelTitle")}</h3>
      <p className="mt-3">{t("booking.cancelQuestion", { label: allocation.cardLabel })}</p>
      {error && <Alert>{error}</Alert>}
      <div className="mt-6 flex justify-end gap-3">
        <Button type="button" className="button-secondary" onClick={closed}>{t("booking.close")}</Button>
        <Button type="button" data-testid="confirm-cancellation" onClick={() => void api.cancelBooking(allocation.bookingId).then(cancelled).catch((failure: unknown) => setError(problemMessage(failure, t)))}>{t("booking.cancelConfirm")}</Button>
      </div>
    </div>
  </Modal>;
}
