// Field by field rather than through a serialisation, which reads a reordered but equal pair as
// changed. Lists are compared by their contents, so a checkbox ticked and unticked again is not.
export function differs<T extends object>(edited?: T, confirmed?: T): boolean {
  if (edited === undefined || confirmed === undefined) return false;
  const fields = new Set([...Object.keys(edited), ...Object.keys(confirmed)]) as Set<keyof T>;
  return [...fields].some((field) => !same(edited[field], confirmed[field]));
}

function same(edited: unknown, confirmed: unknown): boolean {
  if (Array.isArray(edited) && Array.isArray(confirmed)) {
    return edited.length === confirmed.length
      && edited.every((value, index) => value === confirmed[index]);
  }
  return edited === confirmed;
}
