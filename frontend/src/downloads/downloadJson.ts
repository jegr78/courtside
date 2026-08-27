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
  // Not revoked here: WebKit reads the blob after the click returns, and a board member on an
  // iPad would get an empty file. One object URL per answer lives as long as the page does.
}
