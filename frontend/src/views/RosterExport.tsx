import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type ImportSource } from "../api/client";
import { Button } from "../components/Button";
import { downloadBlob } from "../downloads/downloadJson";

const SEPARATORS = [",", ";", "\t"];

interface Props {
  query?: string;
  membershipTypeId?: string;
  disabled: boolean;
  onFailure: (failure: unknown) => void;
}

export function RosterExport({ query, membershipTypeId, disabled, onFailure }: Props) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<ImportSource[]>([]);
  const [encodings, setEncodings] = useState<string[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [separator, setSeparator] = useState(",");
  const [encoding, setEncoding] = useState("UTF-8");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([api.importSources(), api.supportedEncodings()])
      .then(([configured, supported]) => {
        if (!active) return;
        setSources(configured);
        setEncodings(supported);
        // The club already told the import what its own tooling reads, and the same answer is the
        // right one in this direction.
        const only = configured.length === 1 ? configured[0] : undefined;
        if (only) {
          setSourceId(only.id);
          setSeparator(only.separator);
          setEncoding(only.encoding);
        }
      })
      .catch(onFailure);
    return () => {
      active = false;
    };
  }, [onFailure]);

  async function download() {
    if (running) return;
    setRunning(true);
    try {
      const offered = await api.exportRoster({
        query: query ?? "", membershipTypeId: membershipTypeId ?? "", sourceId, separator, encoding
      });
      downloadBlob(offered.fileName, offered.content);
    } catch (failure) {
      onFailure(failure);
    } finally {
      setRunning(false);
    }
  }

  return <section data-testid="roster-export" className="surface-subtle grid gap-3 rounded-xl border p-4">
    <h2 className="text-2xl font-bold">{t("admin.roster.export")}</h2>
    <p className="text-muted text-sm">{t("admin.roster.exportExplain")}</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="grid gap-2 font-medium">
        {t("admin.roster.exportSeparator")}
        <select
          data-testid="roster-export-separator"
          className="form-control rounded-lg border px-3 py-3 outline-none"
          value={separator}
          onChange={(event) => setSeparator(event.target.value)}
        >
          {SEPARATORS.map((character) =>
            <option key={character} value={character}>{t(`admin.roster.separator.${character}`)}</option>)}
        </select>
      </label>
      <label className="grid gap-2 font-medium">
        {t("admin.roster.exportEncoding")}
        <select
          data-testid="roster-export-encoding"
          className="form-control rounded-lg border px-3 py-3 outline-none"
          value={encoding}
          onChange={(event) => setEncoding(event.target.value)}
        >
          {encodings.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      {sources.length > 0 && <label className="grid gap-2 font-medium">
        {t("admin.roster.exportSource")}
        <select
          data-testid="roster-export-source"
          className="form-control rounded-lg border px-3 py-3 outline-none"
          value={sourceId}
          onChange={(event) => setSourceId(event.target.value)}
        >
          <option value="">{t("admin.roster.exportNoSource")}</option>
          {sources.map((source) => <option key={source.id} value={source.id}>{source.displayName}</option>)}
        </select>
      </label>}
    </div>
    <Button
      variant="secondary"
      data-testid="roster-export-download"
      className="justify-self-start"
      disabled={disabled || running}
      type="button"
      onClick={() => void download()}
    >
      {t("admin.roster.exportDownload")}
    </Button>
  </section>;
}
