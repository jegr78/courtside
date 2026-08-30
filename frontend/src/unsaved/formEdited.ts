export function formEdited(form: HTMLFormElement): boolean {
  return [...form.elements].some(fieldEdited);
}

// Against what the form would show after a reset, not against emptiness: a create form whose
// colour picker carries a default would otherwise never read as untouched again.
function fieldEdited(field: Element): boolean {
  if (field instanceof HTMLSelectElement) return field.value !== restored(field);
  if (field instanceof HTMLTextAreaElement) return field.value !== field.defaultValue;
  if (!(field instanceof HTMLInputElement)) return false;
  return field.type === "checkbox" || field.type === "radio"
    ? field.checked !== field.defaultChecked
    : field.value !== field.defaultValue;
}

// A select with nothing marked selected falls back to its first option, the way a reset does.
function restored(select: HTMLSelectElement): string {
  const marked = [...select.options].find((option) => option.defaultSelected);
  return (marked ?? select.options[0])?.value ?? "";
}
