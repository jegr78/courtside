import type { ImportPreview } from "../../api/client";

// A deadline nobody can read is not a deadline in the future, so both answers stay on the safe
// side of a value the server should never send.
function stillOpen(preview: ImportPreview): boolean {
  return Date.parse(preview.expiresAt) > Date.now();
}

export function isExpired(preview: ImportPreview): boolean {
  return !stillOpen(preview);
}

export function isExecutable(preview: ImportPreview): boolean {
  return !preview.superseded && stillOpen(preview);
}
