export const UNPARSED = "data-date-time-unparsed";

export function refuseUnparsedDrafts(scope: ParentNode | null | undefined, include: (field: HTMLInputElement) => boolean = () => true): boolean {
  const fields = [...(scope ?? document).querySelectorAll<HTMLInputElement>(`input[${UNPARSED}]`)].filter(include);
  for (const field of fields) field.dispatchEvent(new Event("invalid", { cancelable: true }));
  fields[0]?.focus();
  return fields.length > 0;
}
