import { type ImportSource } from "../../api/client";

// The one place the section is named, so the surface that asks whether this editor holds anything
// cannot drift from the form that registers it.
export function importSourceMark(source: ImportSource | undefined): string {
  return `import-source:${source?.id ?? "new"}`;
}
