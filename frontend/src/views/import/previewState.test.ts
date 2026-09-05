import { describe, expect, it } from "vitest";
import type { ImportPreview } from "../../api/client";
import { isExecutable, isExpired } from "./previewState";

function preview(fields: Partial<ImportPreview>): ImportPreview {
  return {
    previewId: "preview-1", sourceId: "source-1", mode: "UPDATE_ONLY", fileName: "members.csv",
    fileHash: "abc", rowCount: 0, ignoredColumns: [], changes: [], rowErrors: [],
    possibleDuplicates: [], sharedAddresses: [],
    removals: { count: 0, currentlyLinked: 0, percent: 0 },
    needsConfirmation: false, superseded: false,
    createdAt: "2026-08-21T10:00:00Z", expiresAt: "2126-08-22T10:00:00Z",
    ...fields
  };
}

describe("previewState", () => {

  it("given a preview the server has not superseded and whose deadline is ahead, then the import may run it", () => {
    // when / then
    expect(isExecutable(preview({}))).toBe(true);
    expect(isExpired(preview({}))).toBe(false);
  });

  it("given a preview the server has superseded, then the import may not run it", () => {
    // when / then
    expect(isExecutable(preview({ superseded: true }))).toBe(false);
  });

  it("given a preview whose deadline has passed, then the import may not run it", () => {
    // when / then
    expect(isExecutable(preview({ expiresAt: "2020-08-22T10:00:00Z" }))).toBe(false);
    expect(isExpired(preview({ expiresAt: "2020-08-22T10:00:00Z" }))).toBe(true);
  });

  it("given a deadline that cannot be read at all, then the import may not run it either", () => {
    // when / then — an unreadable deadline is not a deadline in the future
    expect(isExecutable(preview({ expiresAt: "not a moment" }))).toBe(false);
    expect(isExpired(preview({ expiresAt: "not a moment" }))).toBe(true);
  });
});
