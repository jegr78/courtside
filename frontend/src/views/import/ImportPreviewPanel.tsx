import { useState, type ChangeEvent, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { api, type ImportPersonChange, type ImportPreview, type SnapshotMode } from "../../api/client";
import { NotUtf8Error, readCsvHeader } from "../../import/read-csv";
import { Button } from "../../components/Button";

const MODES: SnapshotMode[] = ["UPDATE_ONLY", "FULL_SNAPSHOT"];

function isExpired(preview: ImportPreview): boolean {
  return Date.parse(preview.expiresAt) <= Date.now();
}

function accountsOpenedBy(preview: ImportPreview): number {
  return preview.changes.filter((change) => change.account === "CREATE").length;
}

function changed(change: ImportPersonChange, t: TFunction): string {
  return Object.entries(change.values)
    .map(([field, value]) => `${t(`admin.import.field.${field}`)}: ${value}`).join(", ");
}

export function ImportPreviewPanel({ sourceId, sourceEncoding, preview, disabled, previewed, reportError }: {
  sourceId: string;
  sourceEncoding: string;
  preview: ImportPreview | undefined;
  disabled: boolean;
  previewed: (preview: ImportPreview) => void;
  reportError: (failure: unknown) => void;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<File>();
  const [mode, setMode] = useState<SnapshotMode>("UPDATE_ONLY");
  const [override, setOverride] = useState<string>();
  const [encodings, setEncodings] = useState<string[]>([]);
  const [asksEncoding, setAsksEncoding] = useState(false);
  const [pending, setPending] = useState(false);

  // The source answers for every upload; only a file that deviates from it carries its own answer.
  const encoding = override ?? sourceEncoding;

  // The file is here in the browser, so whether it is UTF-8 is answerable before anybody uploads it.
  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setChosen(file);
    setOverride(undefined);
    setAsksEncoding(false);
    if (!file) return;
    try {
      await readCsvHeader(file, sourceEncoding);
    } catch (failure) {
      if (!(failure instanceof NotUtf8Error)) return;
      setAsksEncoding(true);
      api.supportedEncodings().then(setEncodings).catch(reportError);
    }
  }

  async function upload() {
    if (pending || !chosen) return;
    setPending(true);
    try {
      previewed(await api.createImportPreview(sourceId, chosen, mode, encoding));
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  const busy = disabled || pending;

  return <section className="surface-subtle grid gap-4 rounded-xl border p-4">
    <h2 className="text-2xl font-bold">{t("admin.import.snapshot")}</h2>

    <div className="grid gap-2">
      <label className="font-semibold" htmlFor="snapshot-file">{t("admin.import.snapshotFile")}</label>
      <input data-testid="snapshot-file" id="snapshot-file" type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => void chooseFile(event)} />
    </div>

    {asksEncoding && <div className="grid gap-2">
      <p data-testid="snapshot-not-utf8">{t("admin.import.notUtf8")}</p>
      <label className="font-semibold" htmlFor="snapshot-encoding">{t("admin.import.encoding")}</label>
      <input data-testid="snapshot-encoding" id="snapshot-encoding" list="snapshot-encodings" className="form-control rounded-lg border px-3 py-3" disabled={busy} value={encoding} onChange={(event) => setOverride(event.target.value)} />
      <datalist id="snapshot-encodings">
        {encodings.map((name) => <option key={name} value={name} />)}
      </datalist>
    </div>}

    <div className="grid gap-2">
      <label className="font-semibold" htmlFor="snapshot-mode">{t("admin.import.mode")}</label>
      <select data-testid="snapshot-mode" id="snapshot-mode" className="rounded-md border p-2" disabled={busy} value={mode} onChange={(event) => setMode(event.target.value as SnapshotMode)}>
        {MODES.map((option) => <option key={option} value={option}>{t(`admin.import.mode.${option}`)}</option>)}
      </select>
      <p className="text-sm">{t(`admin.import.modeMeans.${mode}`)}</p>
    </div>

    <Button variant="primary" data-testid="upload-snapshot" disabled={busy || !chosen} className="justify-self-start" type="button" onClick={() => void upload()}>
      {t("admin.import.upload")}
    </Button>

    {preview && <div className="grid gap-3 border-t pt-4">
      <p data-testid="preview-identity">
        {t("admin.import.previewIdentity", {
          fileName: preview.fileName, rowCount: preview.rowCount, fileHash: preview.fileHash
        })}
      </p>

      {preview.superseded && <p data-testid="preview-superseded">{t("admin.import.superseded")}</p>}
      {isExpired(preview) && <p data-testid="preview-expired">{t("admin.import.expired")}</p>}
      {preview.needsConfirmation && <p data-testid="needs-confirmation">
        {t("admin.import.needsConfirmation", {
          ending: preview.removals.count,
          linked: preview.removals.currentlyLinked,
          percent: preview.removals.percent
        })}
      </p>}
      <p data-testid="preview-accounts">{t("admin.import.accounts", { count: accountsOpenedBy(preview) })}</p>
      {preview.ignoredColumns.length > 0 && <p data-testid="preview-ignored-columns">
        {t("admin.import.unmapped", { columns: preview.ignoredColumns.join(", ") })}
      </p>}

      <Section testId="changes" heading={t("admin.import.changes", { shown: preview.changes.length })}>
        <ul className="grid gap-1">
          {preview.changes.map((change) => <li key={`${change.kind}-${change.externalId}`} data-testid={`change-${change.kind}-${change.externalId}`}>
            <span className="font-semibold">{t(`admin.import.kind.${change.kind}`)}</span>
            {" "}<span className="font-mono">{change.externalId}</span>
            {change.personName && <> — {change.personName}</>}
            {Object.keys(change.values).length > 0 && <> — {changed(change, t)}</>}
            {change.account !== "NOT_ASKED" && <> — {t(`admin.import.account.${change.account}`)}</>}
          </li>)}
        </ul>
      </Section>

      <Section testId="row-errors" heading={t("admin.import.rowErrors", { shown: preview.rowErrors.length })}>
        <ul className="grid gap-1">
          {preview.rowErrors.map((error) => <li key={error.rowNumber} data-testid={`row-error-${error.rowNumber}`}>
            {t("admin.import.row", { row: error.rowNumber })} — {t(error.code, error.params)}
          </li>)}
        </ul>
      </Section>

      <Section testId="shared-addresses" heading={t("admin.import.sharedAddresses", { shown: preview.sharedAddresses.length })}>
        <p className="text-sm">{t("admin.import.sharedAddressesExplain")}</p>
        <ul className="grid gap-1">
          {preview.sharedAddresses.map((shared) => <li key={shared.externalId} data-testid={`shared-address-${shared.externalId}`}>
            {t("admin.import.row", { row: shared.rowNumber })}
            {" "}<span className="font-mono">{shared.externalId}</span> — {t("admin.import.sharedBy", { sharedBy: shared.sharedBy })}
          </li>)}
        </ul>
      </Section>

      <Section testId="duplicates" heading={t("admin.import.duplicates", { shown: preview.possibleDuplicates.length })}>
        <p className="text-sm">{t("admin.import.duplicatesExplain")}</p>
        <ul className="grid gap-1">
          {preview.possibleDuplicates.map((duplicate) => <li key={duplicate.externalId} data-testid={`duplicate-${duplicate.externalId}`}>
            {t("admin.import.row", { row: duplicate.rowNumber })}
            {" "}<span className="font-mono">{duplicate.externalId}</span> — {duplicate.personName}
          </li>)}
        </ul>
      </Section>
    </div>}
  </section>;
}

// The count is the information while a section is shut, which is why it lives in the summary.
function Section({ testId, heading, children }: { testId: string; heading: string; children: ReactNode }) {
  return <details className="rounded-lg border p-3">
    <summary data-testid={`${testId}-heading`} className="cursor-pointer font-semibold">{heading}</summary>
    <div className="grid gap-2 pt-3">{children}</div>
  </details>;
}
