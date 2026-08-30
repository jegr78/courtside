export function markId(id: string): string {
  return `unsaved-mark-${id}`;
}

// The save button points at the mark rather than repeating it, so somebody on a screen reader
// hears why it is there when they reach the control the mark belongs to.
export function describedByMark(id: string, unsaved: boolean): string | undefined {
  return unsaved ? markId(id) : undefined;
}
