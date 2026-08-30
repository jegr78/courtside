import { useUnsavedChanges } from "../unsaved/registry";

export function UnsavedCount() {
  return <p data-testid="unsaved-count">{useUnsavedChanges().unsavedCount}</p>;
}
