import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type ImportPreview, type ImportSource, type ImportSourceRequest, type MembershipType } from "../api/client";
import { problemMessage } from "../api/problem-message";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { SuccessFeedback } from "../components/SuccessFeedback";
import { ExternalReferencePanel } from "./import/ExternalReferencePanel";
import { ImportExecutionPanel } from "./import/ImportExecutionPanel";
import { ImportPreviewPanel } from "./import/ImportPreviewPanel";
import { ImportSourceForm } from "./import/ImportSourceForm";

type Editing = { source: ImportSource } | { source: undefined } | undefined;

export function AdminImportView() {
  const { t } = useTranslation();
  const [sources, setSources] = useState<ImportSource[]>();
  const [types, setTypes] = useState<MembershipType[]>([]);
  const [editing, setEditing] = useState<Editing>();
  const [removing, setRemoving] = useState(false);
  const [preview, setPreview] = useState<ImportPreview>();
  const [runCount, setRunCount] = useState(0);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [pending, setPending] = useState(false);

  const reportError = useCallback((failure: unknown) => {
    setSuccess(undefined);
    setError(problemMessage(failure, t));
  }, [t]);

  useEffect(() => {
    void Promise.all([api.importSources(), api.membershipTypes()])
      .then(([described, membershipTypes]) => {
        setSources(described);
        setTypes(membershipTypes);
      })
      .catch(reportError);
  }, [reportError]);

  async function save(request: ImportSourceRequest) {
    if (pending || !editing) return;
    setPending(true);
    try {
      const chosen = editing.source;
      const written = chosen
        ? await api.changeImportSource(chosen.id, request)
        : await api.createImportSource(request);
      setSources((current) => {
        const known = current ?? [];
        return known.some((source) => source.id === written.id)
          ? known.map((source) => source.id === written.id ? written : source)
          : [...known, written];
      });
      setEditing({ source: written });
      setPreview(undefined);
      setError(undefined);
      setSuccess(t("admin.import.saved"));
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  async function remove(source: ImportSource) {
    if (pending) return;
    setPending(true);
    try {
      await api.deleteImportSource(source.id);
      setSources((current) => (current ?? []).filter((known) => known.id !== source.id));
      setEditing(undefined);
      setRemoving(false);
      setError(undefined);
      setSuccess(t("admin.import.saved"));
    } catch (failure) {
      setRemoving(false);
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  const chosen = editing?.source;

  return <section data-testid="admin-import-view" className="surface-panel grid w-full max-w-7xl gap-8 self-start rounded-2xl border p-6 shadow-[0_20px_50px_var(--cs-shadow)] [&>*]:max-w-5xl sm:p-8">
    <h1 className="text-3xl font-bold">{t("admin.import.title")}</h1>
    {error && <Alert>{error}</Alert>}
    {success && <SuccessFeedback>{success}</SuccessFeedback>}

    {sources && <div className="grid gap-3">
      <h2 className="text-2xl font-bold">{t("admin.import.sources")}</h2>
      {sources.length === 0
        ? <p data-testid="no-sources">{t("admin.import.noSources")}</p>
        : <ul className="grid gap-2">
          {sources.map((source) => <li key={source.id}>
            <Button variant="secondary" data-testid={`source-choice-${source.id}`} disabled={pending} type="button" onClick={() => { setEditing({ source }); setPreview(undefined); }}>
              {source.displayName}
            </Button>
          </li>)}
        </ul>}
      <Button variant="primary" data-testid="new-source" disabled={pending} className="justify-self-start" type="button" onClick={() => setEditing({ source: undefined })}>
        {t("admin.import.newSource")}
      </Button>
    </div>}

    {editing && <ImportSourceForm
      key={chosen?.id ?? "new"}
      source={chosen}
      types={types}
      disabled={pending}
      save={save}
    />}

    {chosen && <ImportPreviewPanel
      key={`preview-${chosen.id}`}
      sourceId={chosen.id}
      sourceEncoding={chosen.encoding}
      preview={preview}
      disabled={pending}
      previewed={setPreview}
      reportError={reportError}
    />}

    {chosen && <ImportExecutionPanel
      key={`execution-${chosen.id}`}
      sourceId={chosen.id}
      preview={preview}
      disabled={pending}
      executed={() => {
        setPreview(undefined);
        setRunCount((runs) => runs + 1);
      }}
      reportError={reportError}
    />}

    {chosen && <ExternalReferencePanel
      key={`references-${chosen.id}-${runCount}`}
      sourceId={chosen.id}
      disabled={pending}
      reportError={reportError}
    />}

    {chosen && <Button variant="destructive" data-testid="remove-source" disabled={pending} className="justify-self-start" type="button" onClick={() => setRemoving(true)}>
      {t("admin.import.removeSource")}
    </Button>}

    {removing && chosen && <Modal labelledBy="remove-source-title" closed={() => setRemoving(false)}>
      <div className="grid gap-4">
        <h2 id="remove-source-title" className="text-2xl font-bold">{t("admin.import.removeSource")}</h2>
        <p>{t("admin.import.removeSourceExplain")}</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="destructive" data-testid="confirm-remove-source" disabled={pending} type="button" onClick={() => void remove(chosen)}>
            {t("admin.import.removeSource")}
          </Button>
          <Button variant="secondary" data-testid="cancel-remove-source" type="button" onClick={() => setRemoving(false)}>
            {t("admin.cancel")}
          </Button>
        </div>
      </div>
    </Modal>}
  </section>;
}
