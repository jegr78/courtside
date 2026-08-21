import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type ExternalReference, type RosterEntry } from "../../api/client";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";

const SEARCH_RESULTS = 10;
const NUMBER_LENGTH = 120;

export function ExternalReferencePanel({ sourceId, disabled, reportError }: {
  sourceId: string;
  disabled: boolean;
  reportError: (failure: unknown) => void;
}) {
  const { t } = useTranslation();
  const [references, setReferences] = useState<ExternalReference[]>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<RosterEntry[]>([]);
  const [chosen, setChosen] = useState<RosterEntry>();
  const [externalId, setExternalId] = useState("");
  const [pending, setPending] = useState(false);

  const read = useCallback(async (after?: string) => {
    const page = await api.externalReferences(sourceId, after);
    setReferences((current) => after ? [...(current ?? []), ...page.references] : page.references);
    setCursor(page.nextCursor ?? null);
  }, [sourceId]);

  useEffect(() => {
    void read().catch(reportError);
  }, [read, reportError]);

  useEffect(() => {
    if (!query.trim()) {
      setCandidates([]);
      return;
    }
    void api.roster(query, undefined, SEARCH_RESULTS)
      .then((page) => setCandidates(page.entries))
      .catch(reportError);
  }, [query, reportError]);

  async function link() {
    if (pending || !chosen || !externalId.trim()) return;
    setPending(true);
    try {
      const written = await api.linkExternalReference(sourceId,
        { externalId: externalId.trim(), personId: chosen.personId });
      setReferences((current) => [...(current ?? []), written]);
      setExternalId("");
      setChosen(undefined);
      setQuery("");
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  // Linking again restores exactly what unlinking removed, so this is not a confirmed action.
  async function unlink(reference: ExternalReference) {
    if (pending) return;
    setPending(true);
    try {
      await api.unlinkExternalReference(sourceId, reference.externalId);
      setReferences((current) =>
        (current ?? []).filter((held) => held.referenceId !== reference.referenceId));
    } catch (failure) {
      reportError(failure);
    } finally {
      setPending(false);
    }
  }

  const busy = disabled || pending;

  return <section className="surface-subtle grid gap-4 rounded-xl border p-4">
    <h2 className="text-2xl font-bold">{t("admin.import.references")}</h2>
    <p className="text-sm">{t("admin.import.referencesExplain")}</p>

    {references && (references.length === 0
      ? <p data-testid="no-references">{t("admin.import.noReferences")}</p>
      : <ul className="grid gap-2">
        {references.map((reference) => <li key={reference.referenceId} data-testid={`reference-${reference.externalId}`} className="flex flex-wrap items-center gap-3">
          <span className="font-mono">{reference.externalId}</span>
          <span>{reference.personName}</span>
          <Button data-testid={`unlink-${reference.externalId}`} disabled={busy} type="button" onClick={() => void unlink(reference)}>
            {t("admin.import.unlink")}
          </Button>
        </li>)}
      </ul>)}

    {cursor && <Button data-testid="more-references" disabled={busy} className="justify-self-start" type="button" onClick={() => void read(cursor).catch(reportError)}>
      {t("admin.import.moreReferences")}
    </Button>}

    <div className="grid gap-3 border-t pt-4">
      <h3 className="text-lg font-semibold">{t("admin.import.linkPerson")}</h3>
      <TextField data-testid="reference-person-search" disabled={busy} label={t("admin.import.searchPerson")} value={query} onChange={(event) => setQuery(event.target.value)} />
      {candidates.length > 0 && <ul className="grid gap-2">
        {candidates.map((entry) => <li key={entry.personId}>
          <Button data-testid={`reference-person-${entry.personId}`} disabled={busy} type="button" onClick={() => setChosen(entry)}>
            {entry.firstName} {entry.lastName}
          </Button>
        </li>)}
      </ul>}
      {chosen && <p data-testid="chosen-person">{chosen.firstName} {chosen.lastName}</p>}
      <TextField data-testid="reference-external-id" disabled={busy} maxLength={NUMBER_LENGTH} label={t("admin.import.externalId")} value={externalId} onChange={(event) => setExternalId(event.target.value)} />
      <Button data-testid="link-reference" disabled={busy || !chosen || !externalId.trim()} className="justify-self-start" type="button" onClick={() => void link()}>
        {t("admin.import.link")}
      </Button>
    </div>
  </section>;
}
