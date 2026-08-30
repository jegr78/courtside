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
      && edited.every((value, index) => same(value, confirmed[index]));
  }
  if (plain(edited) && plain(confirmed)) return !differs(edited, confirmed);
  return edited === confirmed;
}

// Only into objects that are nothing but their fields: a Date or a File would otherwise compare
// equal to any other of its kind, because neither carries an own key to tell them apart.
function plain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const inherited = Object.getPrototypeOf(value) as unknown;
  return inherited === Object.prototype || inherited === null;
}
