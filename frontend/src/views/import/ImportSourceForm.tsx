import { useEffect, useId, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type CanonicalField, type ImportSource, type ImportSourceRequest, type MembershipType } from "../../api/client";
import { EncodingUnreadableHereError, NotUtf8Error, readCsvColumn, readCsvHeader, suggestSeparator } from "../../import/read-csv";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { differs } from "../../unsaved/differs";
import { importSourceMark } from "./importSourceMark";
import { describedByMark } from "../../unsaved/markId";
import { UnsavedMark } from "../../unsaved/UnsavedMark";

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

// What the server last confirmed, in the shape the form would send, so the two are comparable at
// all — and what the form starts as, so an untouched source cannot read as changed because the
// two sides spell a default differently. Deliberately unannotated: the generated request type
// carries its fields as optional, and only the inferred one is usable as an initial state.
function described(source: ImportSource | undefined) {
  return {
    sourceKey: source?.sourceKey ?? "",
    displayName: source?.displayName ?? "",
    separator: source?.separator ?? ",",
    encoding: source?.encoding ?? "UTF-8",
    columns: source?.columns ?? {},
    membershipTypes: source?.membershipTypes ?? {},
    defaultMembershipTypeId: source?.defaultMembershipTypeId ?? "",
    ownedFields: OWNABLE.filter((field) => (source?.ownedFields ?? []).includes(field)),
    removalWarningPercent: source?.removalWarningPercent ?? 10
  };
}

// A category left unassigned is absent from the request, so it has to be absent from the
// comparison too — otherwise one arriving from the server would mark the source unsaved for good.
function assigned(categories: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(categories ?? {}).filter(([, typeId]) => typeId));
}

// Without a prototype, because a column a club named __proto__ would otherwise reach the inherited
// setter and disappear from the mapping instead of becoming a key of its own.
function columnsOf(mapping: Mapping): Record<string, CanonicalField> {
  const columns = Object.create(null) as Record<string, CanonicalField>;
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
  const confirmed = described(source);
  const [chosen, setChosen] = useState<File>();
  const [headers, setHeaders] = useState<string[]>([]);
  const [readValues, setReadValues] = useState<string[]>([]);
  const [sourceKey, setSourceKey] = useState(confirmed.sourceKey);
  const [displayName, setDisplayName] = useState(confirmed.displayName);
  const [mapping, setMapping] = useState<Mapping>(mappingOf(source));
  const [categories, setCategories] = useState<Record<string, string>>(confirmed.membershipTypes);
  const [defaultType, setDefaultType] = useState(confirmed.defaultMembershipTypeId);
  const [owned, setOwned] = useState<CanonicalField[]>(confirmed.ownedFields);
  const [threshold, setThreshold] = useState(String(confirmed.removalWarningPercent));
  const [separator, setSeparator] = useState(confirmed.separator);
  const [encoding, setEncoding] = useState(confirmed.encoding);
  const [encodings, setEncodings] = useState<string[]>([]);
  const [unreadableHere, setUnreadableHere] = useState(false);
  const [asksEncoding, setAsksEncoding] = useState(false);

  const categoryColumn = mapping.MEMBERSHIP_TYPE;
  const knownValues = [...new Set([...Object.keys(categories), ...readValues])];
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  const unmapped = headers.filter((header) => !mapped.has(header));

  useEffect(() => {
    void api.supportedEncodings().then(setEncodings).catch(() => setEncodings([]));
  }, []);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setChosen(file);
    setAsksEncoding(false);
    try {
      await readWith(encoding, file, await separatorFor(file, encoding));
    } catch (failure) {
      if (failure instanceof EncodingUnreadableHereError) return showUnreadableHere();
      if (!(failure instanceof NotUtf8Error)) throw failure;
      setAsksEncoding(true);
      const legacy = "windows-1252";
      await readWith(legacy, file, await separatorFor(file, legacy));
    }
  }

  // A source that has already been described carries the club's answer; only a new one is guessed at.
  async function separatorFor(file: File, chosenEncoding: string) {
    return source ? separator : suggestSeparator(file, chosenEncoding);
  }

  async function readWith(chosenEncoding: string, file = chosen, chosenSeparator = separator) {
    setEncoding(chosenEncoding);
    setSeparator(chosenSeparator);
    setUnreadableHere(false);
    if (!file) return;
    try {
      setHeaders(await readCsvHeader(file, chosenEncoding, chosenSeparator));
      if (categoryColumn) {
        setReadValues(await readCsvColumn(file, categoryColumn, chosenEncoding, chosenSeparator));
      }
    } catch (failure) {
      if (!(failure instanceof EncodingUnreadableHereError)) throw failure;
      showUnreadableHere();
    }
  }

  function showUnreadableHere() {
    setUnreadableHere(true);
    setHeaders([]);
    setReadValues([]);
  }

  async function mapField(field: CanonicalField, column: string) {
    setMapping((current) => ({ ...current, [field]: column }));
    if (field !== "MEMBERSHIP_TYPE") return;
    setReadValues(chosen && column ? await readCsvColumn(chosen, column, encoding, separator) : []);
  }

  function requested(): ImportSourceRequest {
    return {
      sourceKey,
      displayName,
      separator,
      encoding,
      columns: columnsOf(mapping),
      membershipTypes: assigned(categories),
      defaultMembershipTypeId: defaultType,
      // In the canonical order rather than the order they were ticked, so a field taken back and
      // given again leaves the same request rather than a reordered one.
      ownedFields: OWNABLE.filter((field) => owned.includes(field)),
      removalWarningPercent: Number(threshold)
    };
  }

  function submit() {
    void save(requested());
  }

  const mark = importSourceMark(source);
  // Assigned on both sides: an unassigned category is dropped from the request, so comparing it
  // against one the server still holds would mark a source unsaved with nothing to save.
  const unsaved = differs(requested(), { ...confirmed, membershipTypes: assigned(confirmed.membershipTypes) });

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
      <label className="font-semibold" htmlFor={`${group}-separator`}>{t("admin.import.separator")}</label>
      <input data-testid="source-separator" id={`${group}-separator`} className="form-control rounded-lg border px-3 py-3" maxLength={1} disabled={disabled} value={separator} onChange={(event) => void readWith(encoding, chosen, event.target.value)} />
      <p className="text-sm">{t("admin.import.separatorHint")}</p>
      {asksEncoding && <p data-testid="source-not-utf8">{t("admin.import.notUtf8")}</p>}
      <label className="font-semibold" htmlFor={`${group}-encoding`}>{t("admin.import.encoding")}</label>
      <input data-testid="source-encoding" id={`${group}-encoding`} list={`${group}-encodings`} className="form-control rounded-lg border px-3 py-3" disabled={disabled} value={encoding} onChange={(event) => void readWith(event.target.value)} />
      <datalist id={`${group}-encodings`}>
        {encodings.map((name) => <option key={name} value={name} />)}
      </datalist>
      <p className="text-sm">{t("admin.import.encodingHint")}</p>
      {unreadableHere && <p data-testid="source-encoding-unreadable">{t("admin.import.encodingUnreadableHere")}</p>}
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

    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" data-testid="save-source" aria-describedby={describedByMark(mark, unsaved)} disabled={disabled} type="button" onClick={submit}>{t("admin.save")}</Button>
      <UnsavedMark id={mark} unsaved={unsaved} />
    </div>
  </section>;
}
