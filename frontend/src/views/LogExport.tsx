import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type ExportedLog } from "../api/client";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { downloadBlob } from "../downloads/downloadJson";
import { formString } from "../forms/formString";

const SEPARATORS = [",", ";", "\t"];

interface Props {
  log: ExportedLog;
  onFailure: (failure: unknown) => void;
}

export function LogExport({ log, onFailure }: Props) {
  const { t } = useTranslation();
  const [encodings, setEncodings] = useState<string[]>([]);
  const [separator, setSeparator] = useState(",");
  const [encoding, setEncoding] = useState("UTF-8");
  const [running, setRunning] = useState(false);
  const id = `${log}-log-export`;

  useEffect(() => {
    let active = true;
    void Promise.all([api.importSources(), api.supportedEncodings()])
      .then(([configured, supported]) => {
        if (!active) return;
        setEncodings(supported);
        const only = configured.length === 1 ? configured[0] : undefined;
        if (only) {
          setSeparator(only.separator);
          setEncoding(only.encoding);
        }
      })
      .catch(onFailure);
    return () => {
      active = false;
    };
  }, [onFailure]);

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running) return;
    setRunning(true);
    const form = new FormData(event.currentTarget);
    try {
      const exported = log === "audit" ? api.exportAuditLog : api.exportMessageLog;
      const offered = await exported({
        from: formString(form, "from"), to: formString(form, "to"), separator, encoding
      });
      downloadBlob(offered.fileName, offered.content);
    } catch (failure) {
      onFailure(failure);
    } finally {
      setRunning(false);
    }
  }

  return <section data-testid={id} className="grid gap-3 rounded-xl border p-4">
    <h2 className="text-2xl font-bold">{t(`admin.export.log.${log}`)}</h2>
    <p className="text-muted text-sm">{t(`admin.export.log.${log}Explain`)}</p>
    <form noValidate onSubmit={(event) => void download(event)} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <TextField data-testid={`${id}-from`} name="from" type="date" label={t("admin.export.log.from")} />
        <TextField data-testid={`${id}-to`} name="to" type="date" label={t("admin.export.log.to")} />
        <label className="grid gap-2 font-medium">
          {t("admin.export.separator")}
          <select
            data-testid={`${id}-separator`}
            className="form-control rounded-lg border px-3 py-3"
            value={separator}
            onChange={(event) => setSeparator(event.target.value)}
          >
            {SEPARATORS.map((character) =>
              <option key={character} value={character}>{t(`admin.export.separator.${character}`)}</option>)}
          </select>
        </label>
        <label className="grid gap-2 font-medium">
          {t("admin.export.encoding")}
          <select
            data-testid={`${id}-encoding`}
            className="form-control rounded-lg border px-3 py-3"
            value={encoding}
            onChange={(event) => setEncoding(event.target.value)}
          >
            {encodings.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>
      <Button variant="secondary" data-testid={`${id}-download`} className="justify-self-start" disabled={running} type="submit">
        {t("admin.export.download")}
      </Button>
    </form>
  </section>;
}
