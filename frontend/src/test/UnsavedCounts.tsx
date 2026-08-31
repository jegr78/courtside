import { useUnsavedChanges } from "../unsaved/registry";

// A mark set and cleared again across two renders never shows in the count a later assertion reads,
// and that is the mark that blocks a navigation and then withdraws the question explaining it. Every
// rendered count is recorded here so a test can assert on the highest one instead.
export function UnsavedCounts({ seen }: { seen: number[] }) {
  seen.push(useUnsavedChanges().unsavedCount);
  return null;
}
