import type { ImportPreview } from "../../api/client";

export function isExpired(preview: ImportPreview): boolean {
  return Date.parse(preview.expiresAt) <= Date.now();
}

export function isExecutable(preview: ImportPreview): boolean {
  return !preview.superseded && !isExpired(preview);
}
