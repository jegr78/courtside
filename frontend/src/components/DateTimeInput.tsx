import { type FocusEvent, type FormEvent, type InputHTMLAttributes, useId, useState } from "react";
import { useTranslation } from "react-i18next";

export type DateTimeType = "date" | "time" | "datetime-local";

export type DateTimeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  type: DateTimeType;
  emptyHint?: string;
  "data-testid"?: string;
};

/** A date or time input that shows a visible, announced hint instead of a browser's ghost value while it is empty. */
export function DateTimeInput({ value, defaultValue, emptyHint, onChange, onInput, onBlur, "aria-describedby": describedBy, ...props }: DateTimeInputProps) {
  const { t } = useTranslation();
  const hintId = useId();
  const [entered, setEntered] = useState(String(defaultValue ?? ""));
  const [partial, setPartial] = useState(false);
  const empty = !partial && (value === undefined ? entered : String(value)) === "";
  const testId = props["data-testid"];
  // A partly typed value reads as "" although the browser still shows its digits.
  const notePartial = (event: FormEvent<HTMLInputElement> | FocusEvent<HTMLInputElement>) =>
    setPartial(event.currentTarget.validity.badInput);
  return <span className="date-time-field">
    <input
      {...props}
      value={value}
      defaultValue={defaultValue}
      data-empty={empty ? "true" : undefined}
      aria-describedby={[describedBy, empty ? hintId : undefined].filter(Boolean).join(" ") || undefined}
      onChange={(event) => {
        setEntered(event.target.value);
        onChange?.(event);
      }}
      onInput={(event) => {
        notePartial(event);
        onInput?.(event);
      }}
      onBlur={(event) => {
        notePartial(event);
        onBlur?.(event);
      }}
    />
    {empty && <span id={hintId} data-testid={testId && `${testId}-empty`} aria-hidden="true" className="date-time-empty">
      <span>{emptyHint ?? t("field.notSet")}</span>
    </span>}
  </span>;
}
