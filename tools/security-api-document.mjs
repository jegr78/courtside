import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const checkout = () => fileURLToPath(new URL("../src/main/resources/api/openapi.yaml", import.meta.url));

// A paired comparison runs both toolchains against the base revision's application, so both must be
// driven by that revision's contract — a candidate's own document reports its API change as a tool one.
export function apiDocumentPath(environment = process.env) {
  const chosen = environment.COURTSIDE_SECURITY_API_DOCUMENT;
  if (chosen === undefined || chosen === "") return checkout();
  // Compose turns a bind source that does not exist into a directory and starts anyway, so an
  // unusable value has to be refused here rather than surface as a contract that fails its digest.
  if (!isAbsolute(chosen) || !existsSync(chosen)) {
    throw new Error(`COURTSIDE_SECURITY_API_DOCUMENT must name an existing absolute path: ${chosen}`);
  }
  return chosen;
}
