import { availableLocales, supportedLocale, type SupportedLocale } from "../i18n";

export function LocaleSelect({ id, testId, value, disabled, supported, className, changed }: {
  id?: string;
  testId?: string;
  value: string;
  disabled?: boolean;
  supported?: string[];
  className?: string;
  changed: (locale: SupportedLocale) => void;
}) {
  return <select
    id={id}
    data-testid={testId}
    disabled={disabled}
    className={className}
    value={value}
    onChange={(event) => {
      const locale = supportedLocale(event.target.value);
      if (locale) changed(locale);
    }}
  >
    {availableLocales(supported).map((locale) =>
      <option key={locale} value={locale}>{endonym(locale)}</option>)}
  </select>;
}

// The language names itself, so a new bundle needs no label written for it anywhere.
function endonym(locale: string): string {
  return new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
}
