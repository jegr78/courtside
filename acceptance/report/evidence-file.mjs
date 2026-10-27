import { openSync, fstatSync, readFileSync, closeSync, constants } from "node:fs";

export function readEvidence(path) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(descriptor).isFile()) throw new Error("Evidence is not a regular file");
    return readFileSync(descriptor);
  } finally { closeSync(descriptor); }
}
