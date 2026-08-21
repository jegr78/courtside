import { useId, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import type { CanonicalField, ImportSource, ImportSourceRequest, MembershipType } from "../../api/client";
import { readCsvColumn, readCsvHeader } from "../../import/read-csv";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";

const FIELDS: CanonicalField[] = [
  "EXTERNAL_ID", "FIRST_NAME", "LAST_NAME", "EMAIL", "MEMBERSHIP_TYPE"
];
// A record is identified by its external id rather than described by it, so no source owns it.
const OWNABLE = FIELDS.filter((field) => field !== "EXTERNAL_ID");
const KEY_LENGTH = 40;
const NAME_LENGTH = 80;

type Mapping = Partial<Record<CanonicalField, string>>;

function mappingOf(source: ImportSource | undefined): Mapping {
  const mapping: Mapping = {};
  Object.entries(source?.columns ?? {}).forEach(([column, field]) => { mapping[field] = column; });
  return mapping;
}

function columnsOf(mapping: Mapping): Record<string, CanonicalField> {
  const columns: Record<string, CanonicalField> = {};
  FIELDS.forEach((field) => {
    const column = mapping[field];
    if (column) columns[column] = field;
  });
  return columns;
}

export function ImportSourceForm({ source, types, disabled, save }: {
  source: ImportSource | undefined;
  types: MembershipType[];
  disabled: boolean;
  save: (request: ImportSourceRequest) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const group = useId();
  const [chosen, setChosen] = useState<File>();
  const [headers, setHeaders] = useState<string[]>([]);
  const [readValues, setReadValues] = useState<string[]>([]);
  const [sourceKey, setSourceKey] = useState(source?.sourceKey ?? "");
  const [displayName, setDisplayName] = useState(source?.displayName ?? "");
  const [mapping, setMapping] = useState<Mapping>(mappingOf(source));
  const [categories, setCategories] = useState<Record<string, string>>(source?.membershipTypes ?? {});
  const [defaultType, setDefaultType] = useState(source?.defaultMembershipTypeId ?? "");
  const [owned, setOwned] = useState<CanonicalField[]>(source?.ownedFields ?? []);
  const [threshold, setThreshold] = useState(String(source?.removalWarningPercent ?? 10));

  const categoryColumn = mapping.MEMBERSHIP_TYPE;
  const knownValues = [...new Set([...Object.keys(categories), ...readValues])];
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  const unmapped = headers.filter((header) => !mapped.has(header));

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setChosen(file);
    setHeaders(await readCsvHeader(file));
    if (categoryColumn) setReadValues(await readCsvColumn(file, categoryColumn));
  }

  async function mapField(field: CanonicalField, column: string) {
    setMapping((current) => ({ ...current, [field]: column }));
    if (field !== "MEMBERSHIP_TYPE") return;
    setReadValues(chosen && column ? await readCsvColumn(chosen, column) : []);
  }

  function submit() {
    void save({
      sourceKey,
      displayName,
      columns: columnsOf(mapping),
      membershipTypes: Object.fromEntries(
        Object.entries(categories).filter(([, typeId]) => typeId)),
      defaultMembershipTypeId: defaultType,
      ownedFields: owned,
      removalWarningPercent: Number(threshold)
    });
  }

  // The column choices come from the club's own file, which is why it is read here and never sent.
  return <section className="surface-subtle grid gap-4 rounded-xl border p-4">
    <h2 className="text-2xl font-bold">{t("admin.import.source")}</h2>

    <div className="grid gap-3 md:grid-cols-2">
      <TextField data-testid="source-key" disabled={disabled} maxLength={KEY_LENGTH} label={t("admin.import.sourceKey")} value={sourceKey} onChange={(event) => setSourceKey(event.target.value)} />
      <TextField data-testid="source-name" disabled={disabled} maxLength={NAME_LENGTH} label={t("admin.import.sourceName")} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
    </div>

    <div className="grid gap-2">
      <label className="font-semibold" htmlFor={`${group}-file`}>{t("admin.import.file")}</label>
      <input data-testid="source-file" id={`${group}-file`} type="file" accept=".csv,text/csv" disabled={disabled} onChange={(event) => void chooseFile(event)} />
      <p className="text-sm">{t("admin.import.fileStaysHere")}</p>
    </div>

    <div className="grid gap-3">
      <h3 className="text-lg font-semibold">{t("admin.import.columns")}</h3>
      {FIELDS.map((field) => <div key={field} className="grid gap-1">
        <label className="font-semibold" htmlFor={`${group}-column-${field}`}>{t(`admin.import.field.${field}`)}</label>
        <select data-testid={`column-${field}`} id={`${group}-column-${field}`} className="rounded-md border p-2" disabled={disabled} value={mapping[field] ?? ""} onChange={(event) => void mapField(field, event.target.value)}>
          <option value="">{t("admin.import.noColumn")}</option>
          {[...new Set([...headers, mapping[field] ?? ""])].filter(Boolean).map((header) =>
            <option key={header} value={header}>{header}</option>)}
        </select>
      </div>)}
      {unmapped.length > 0 && <p data-testid="unmapped-columns" className="text-sm">
        {t("admin.import.unmapped", { columns: unmapped.join(", ") })}
      </p>}
    </div>

    {categoryColumn && knownValues.length > 0 && <div className="grid gap-3">
      <h3 className="text-lg font-semibold">{t("admin.import.categories")}</h3>
      {knownValues.map((value) => <div key={value} className="grid gap-1">
        <label className="font-semibold" htmlFor={`${group}-category-${value}`}>{value}</label>
        <select data-testid={`category-${value}`} id={`${group}-category-${value}`} className="rounded-md border p-2" disabled={disabled} value={categories[value] ?? ""} onChange={(event) => setCategories({ ...categories, [value]: event.target.value })}>
          <option value="">{t("admin.import.noType")}</option>
          {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
        </select>
      </div>)}
    </div>}

    <div className="grid gap-1">
      <label className="font-semibold" htmlFor={`${group}-default-type`}>{t("admin.import.defaultType")}</label>
      <select data-testid="source-default-type" id={`${group}-default-type`} className="rounded-md border p-2" disabled={disabled} value={defaultType} onChange={(event) => setDefaultType(event.target.value)}>
        <option value="">{t("admin.import.noType")}</option>
        {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
      </select>
    </div>

    <fieldset className="grid gap-2">
      <legend className="font-semibold">{t("admin.import.ownedFields")}</legend>
      <p className="text-sm">{t("admin.import.ownedFieldsHint")}</p>
      {OWNABLE.map((field) => <label key={field} className="flex items-center gap-2">
        <input data-testid={`owned-${field}`} type="checkbox" disabled={disabled} checked={owned.includes(field)} onChange={(event) => setOwned(event.target.checked
          ? [...owned, field]
          : owned.filter((held) => held !== field))} />
        {t(`admin.import.field.${field}`)}
      </label>)}
    </fieldset>

    <TextField data-testid="source-threshold" disabled={disabled} type="number" min={0} max={100} label={t("admin.import.removalWarning")} value={threshold} onChange={(event) => setThreshold(event.target.value)} />

    <Button data-testid="save-source" disabled={disabled} className="justify-self-start" type="button" onClick={submit}>{t("admin.save")}</Button>
  </section>;
}
