import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type ImportPreview, type ImportRun } from "../../api/client";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { SuccessFeedback } from "../../components/SuccessFeedback";
import { formatDateTime } from "../../time/clubZone";
import { isExecutable } from "./previewState";

const NUMBERS = [
  "created", "corrected", "membershipsEnded", "accountsCreated", "accountsDisabled",
  "rolesRemoved", "rowErrors"
] as const;

export function ImportExecutionPanel({ sourceId, preview, disabled, timeZone, executed, reportError }: {
  sourceId: string;
  preview: ImportPreview | undefined;
  disabled: boolean;
  timeZone: string | undefined;
  executed: (run: ImportRun) => void;
  reportError: (failure: unknown) => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const [runs, setRuns] = useState<ImportRun[]>();
  const [result, setResult] = useState<ImportRun>();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const read = useCallback(async () => setRuns(await api.importRuns(sourceId)), [sourceId]);

  useEffect(() => {
    void read().catch(reportError);
  }, [read, reportError]);

  async function execute(reviewed: ImportPreview) {
    if (pending) return;
    setPending(true);
    try {
      const run = await api.executeImportPreview(reviewed.previewId, reviewed.needsConfirmation);
      setResult(run);
      setRuns((current) => [run, ...(current ?? [])]);
      setConfirming(false);
      executed(run);
    } catch (failure) {
      setConfirming(false);
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  const busy = disabled || pending;

  return <section className="surface-subtle grid gap-4 rounded-xl border p-4">
    <h2 className="text-2xl font-bold">{t("admin.import.execution")}</h2>

    {preview && (isExecutable(preview)
      ? <Button variant={preview.needsConfirmation ? "destructive" : "primary"} data-testid="execute-preview" disabled={busy} className="justify-self-start" type="button" onClick={() => setConfirming(true)}>
        {t("admin.import.execute")}
      </Button>
      : <p data-testid="not-executable">{t("admin.import.notExecutable")}</p>)}

    {result && <SuccessFeedback testId="run-result"><div className="grid gap-1">
      <h3 className="text-lg font-semibold">{t("admin.import.runResult")}</h3>
      {NUMBERS.map((number) => <p key={number} data-testid={`run-result-${number}`}>
        {t(`admin.import.run.${number}`, { value: result[number] })}
      </p>)}
    </div></SuccessFeedback>}

    <div className="grid gap-2 border-t pt-4">
      <h3 className="text-lg font-semibold">{t("admin.import.runLog")}</h3>
      {!timeZone
        ? <p role="status" data-testid="runs-loading">{t("admin.import.runsLoading")}</p>
        : runs && (runs.length === 0
        ? <p data-testid="no-runs">{t("admin.import.noRuns")}</p>
        : <ul className="grid gap-2">
          {runs.map((held) => <li key={held.runId} data-testid={`import-run-${held.runId}`} className="rounded-lg border p-2">
            <p>{t("admin.import.runAt", { at: formatDateTime(held.executedAt, language, timeZone) })}</p>
            <p>{NUMBERS.map((number) => t(`admin.import.run.${number}`, { value: held[number] })).join(" · ")}</p>
          </li>)}
        </ul>)}
    </div>

    {confirming && preview && <Modal labelledBy="execute-title" closed={() => setConfirming(false)}>
      <div className="grid gap-4">
        <h2 id="execute-title" className="text-2xl font-bold">{t("admin.import.execute")}</h2>
        <p>{t("admin.import.executeExplain", { fileName: preview.fileName, rowCount: preview.rowCount })}</p>
        {preview.needsConfirmation && <p data-testid="confirm-removals-note">
          {t("admin.import.confirmRemovals", {
            ending: preview.removals.count,
            linked: preview.removals.currentlyLinked,
            percent: preview.removals.percent
          })}
        </p>}
        <div className="flex flex-wrap gap-3">
          <Button variant={preview.needsConfirmation ? "destructive" : "primary"} data-testid="confirm-execute" disabled={busy} type="button" onClick={() => void execute(preview)}>
            {t("admin.import.execute")}
          </Button>
          <Button variant="secondary" data-testid="cancel-execute" type="button" onClick={() => setConfirming(false)}>
            {t("admin.cancel")}
          </Button>
        </div>
      </div>
    </Modal>}
  </section>;
}
