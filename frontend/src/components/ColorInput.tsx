import { useTranslation } from "react-i18next";
import { TextField } from "./TextField";

const COMPLETE_HEX = /^#[0-9a-fA-F]{6}$/;

export function ColorInput({ id, valueTestId, pickerTestId, value, changed, disabled, name }: {
  id: string;
  valueTestId: string;
  pickerTestId: string;
  value: string;
  changed: (value: string) => void;
  disabled?: boolean;
  name?: string;
}) {
  const { t } = useTranslation();
  return <div className="grid grid-cols-[minmax(0,1fr)_4rem] items-end gap-3">
    <TextField id={`${id}-value`} data-testid={valueTestId} name={name} disabled={disabled} label={t("admin.config.colorHex")}
               value={value} onChange={(event) => changed(event.target.value)} />
    <label className="grid gap-2 text-sm font-medium" htmlFor={`${id}-picker`}>
      {t("admin.config.colorPicker")}
      <input id={`${id}-picker`} data-testid={pickerTestId} type="color" disabled={disabled}
             value={COMPLETE_HEX.test(value) ? value.toLowerCase() : "#000000"}
             className="form-control h-12 w-full cursor-pointer rounded-lg border p-1"
             onChange={(event) => changed(event.target.value)} />
    </label>
  </div>;
}
