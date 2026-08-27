const REVOKE_AFTER_MS = 60_000;

export function downloadJson(fileName: string, content: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(content, null, 2)], { type: "application/json" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Not revoked with the click: WebKit reads the blob after it returns, and a board member on an
  // iPad would save an empty file. Revoked later, so the answer is not resolvable for the session.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
