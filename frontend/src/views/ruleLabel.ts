import i18n from "../i18n";

// A violation code names its rule in camel case; the rule's label is the clearest thing to show a board.
export function ruleLabel(code: string, t: (key: string) => string): string {
  const rule = /^booking\.rule\.([a-zA-Z]+)/.exec(code)?.[1];
  const type = rule?.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
  if (type && i18n.exists(`admin.rules.type.${type}`)) return t(`admin.rules.type.${type}`);
  return i18n.exists(code) ? t(code) : code;
}
