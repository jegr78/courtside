import { type InputHTMLAttributes, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { dateTimeNumber, formatDateTime, parseDateTime } from "./localizedDateTime";

export type DateTimeType = "date" | "time" | "datetime-local";

export type DateTimeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> & {
  type: DateTimeType;
  onValueChange?: (value: string) => void;
  emptyHint?: string;
  "data-testid"?: string;
};

const UNPARSED = "data-date-time-unparsed";

export function refuseUnparsedDrafts(scope: ParentNode | null | undefined, include: (field: HTMLInputElement) => boolean = () => true): boolean {
  const fields = [...(scope ?? document).querySelectorAll<HTMLInputElement>(`input[${UNPARSED}]`)].filter(include);
  for (const field of fields) field.dispatchEvent(new Event("invalid", { cancelable: true }));
  fields[0]?.focus();
  return fields.length > 0;
}

export function DateTimeInput({ type, value, defaultValue, emptyHint, onValueChange, onBlur, onInvalid, name, min, max, step, "aria-describedby": describedBy, ...props }: DateTimeInputProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const hintId = useId();
  const formatId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [flagged, setFlagged] = useState(false);
  const initial = String(value ?? defaultValue ?? "");
  const [state, setState] = useState(() => ({ source: initial, emitted: undefined as string | undefined, locale, draft: formatDateTime(initial, type, locale) }));
  const incoming = value === undefined ? state.source : String(value);
  if (incoming !== state.source || locale !== state.locale || state.emitted !== undefined) {
    const parsed = parseDateTime(state.draft, type, state.locale);
    setState({ source: incoming, emitted: undefined, locale, draft: incoming !== state.source
      ? incoming === state.emitted ? state.draft : formatDateTime(incoming, type, locale)
      : locale !== state.locale && parsed !== null ? formatDateTime(parsed, type, locale) : state.draft });
  }
  const parsed = parseDateTime(state.draft, type, state.locale);
  const canonical = parsed ?? "";
  const empty = state.draft === "";
  const example = formatDateTime(type === "date" ? "2006-11-22" : type === "time" ? "16:05" : "2006-11-22T16:05", type, locale);
  let invalid = parsed === null || Boolean(props.required && canonical === "" && !empty);
  if (canonical) {
    const number = dateTimeNumber(canonical, type);
    const lower = min === undefined ? undefined : dateTimeNumber(String(min), type);
    const upper = max === undefined ? undefined : dateTimeNumber(String(max), type);
    const wraps = type === "time" && lower !== undefined && upper !== undefined && lower > upper;
    invalid ||= wraps ? number < lower && number > upper
      : (lower !== undefined && number < lower) || (upper !== undefined && number > upper);
    if (step !== "any") {
      const interval = Number(step ?? (type === "date" ? 1 : 60)) * (type === "date" ? 86_400_000 : 1000);
      const base = lower ?? (defaultValue ? dateTimeNumber(String(defaultValue), type) : 0);
      if (interval > 0) invalid ||= Math.abs((number - base) / interval - Math.round((number - base) / interval)) > 1e-7;
    }
  }
  const unparsed = parsed === null;
  const shown = flagged && unparsed;
  useLayoutEffect(() => {
    input.current?.setCustomValidity(invalid ? t("field.invalidDateTime", { example }) : "");
  }, [invalid, t, example]);
  useLayoutEffect(() => {
    const field = input.current;
    const form = field?.form;
    if (!field || !form || !unparsed) return;
    const refuse = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      setFlagged(true);
      if (form.querySelector(`input[${UNPARSED}]`) === field) field.focus();
    };
    form.addEventListener("submit", refuse);
    return () => form.removeEventListener("submit", refuse);
  }, [unparsed]);
  useLayoutEffect(() => {
    const form = input.current?.form;
    const reset = () => {
      const restored = String(value ?? defaultValue ?? "");
      setState({ source: restored, emitted: undefined, locale, draft: formatDateTime(restored, type, locale) });
      setFlagged(false);
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [value, defaultValue, type, locale]);
  const testId = props["data-testid"];
  return <span className="grid min-w-0 gap-1">
    <span className="date-time-field">
      <input {...props} ref={input} type="text"
        autoCapitalize="off" spellCheck={false} value={state.draft} placeholder={example}
        data-date-time-type={type} data-empty={empty ? "true" : undefined} {...{ [UNPARSED]: unparsed ? "true" : undefined }}
        aria-invalid={shown || undefined}
        aria-describedby={[describedBy, shown ? errorId : undefined, empty ? hintId : undefined, formatId].filter(Boolean).join(" ") || undefined}
        onChange={(event) => {
          const draft = event.target.value;
          const next = parseDateTime(draft, type, locale);
          if (next === null) {
            setState({ source: value === undefined ? state.source : incoming, emitted: undefined, locale, draft });
            return;
          }
          setState({ source: value === undefined ? next : incoming, emitted: value === undefined ? undefined : next, locale, draft });
          setFlagged(false);
          onValueChange?.(next);
        }}
        onInvalid={(event) => {
          if (unparsed) setFlagged(true);
          onInvalid?.(event);
        }}
        onBlur={(event) => {
          if (parsed !== null) setState((current) => ({ ...current, draft: formatDateTime(parsed, type, locale) }));
          else setFlagged(true);
          onBlur?.(event);
        }} />
      <span id={formatId} aria-hidden="true" className="sr-only">{t("field.dateTimeFormat", { example })}</span>
      <input type="hidden" name={name} form={props.form} value={canonical} disabled={props.disabled} />
      {empty && <span id={hintId} data-testid={testId && `${testId}-empty`} aria-hidden="true" className="date-time-empty">
        <span>{emptyHint ?? t("field.notSet")}</span>
      </span>}
    </span>
    {shown && <span id={errorId} data-testid={testId && `${testId}-invalid`} className="text-destructive text-sm font-normal">
      {t("field.invalidDateTime", { example })}
    </span>}
  </span>;
}
