import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { downloadBlob } from "../downloads/downloadJson";
import { formString } from "../forms/formString";

const SEPARATORS = [",", ";", "\t"];

interface Props {
  onFailure: (failure: unknown) => void;
}

export function BookingsExport({ onFailure }: Props) {
  const { t } = useTranslation();
  const [encodings, setEncodings] = useState<string[]>([]);
  const [separator, setSeparator] = useState(",");
  const [encoding, setEncoding] = useState("UTF-8");
  const [running, setRunning] = useState(false);

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
      const offered = await api.exportBookings({
        from: formString(form, "from"), to: formString(form, "to"), separator, encoding
      });
      downloadBlob(offered.fileName, offered.content);
    } catch (failure) {
      onFailure(failure);
    } finally {
      setRunning(false);
    }
  }

  return <section data-testid="bookings-export" className="surface-subtle grid gap-3 rounded-xl border p-4">
    <h2 className="text-2xl font-bold">{t("admin.export.bookings")}</h2>
    <p className="text-muted text-sm">{t("admin.export.bookingsExplain")}</p>
    <form noValidate onSubmit={(event) => void download(event)} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <TextField data-testid="bookings-export-from" name="from" type="date" required label={t("admin.export.from")} />
        <TextField data-testid="bookings-export-to" name="to" type="date" required label={t("admin.export.to")} />
        <label className="grid gap-2 font-medium">
          {t("admin.export.separator")}
          <select
            data-testid="bookings-export-separator"
            className="form-control rounded-lg border px-3 py-3 outline-none"
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
            data-testid="bookings-export-encoding"
            className="form-control rounded-lg border px-3 py-3 outline-none"
            value={encoding}
            onChange={(event) => setEncoding(event.target.value)}
          >
            {encodings.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>
      <Button variant="secondary" data-testid="bookings-export-download" className="justify-self-start" disabled={running} type="submit">
        {t("admin.export.download")}
      </Button>
    </form>
  </section>;
}
