import i18n from "../i18n";

export function ruleLabel(code: string, t: (key: string) => string): string {
  const key = `admin.usage.reason.${code}`;
  return i18n.exists(key) ? t(key) : code;
}
