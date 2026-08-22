import { fileURLToPath } from "node:url";

// A paired comparison runs both toolchains against the base revision's application, so both must be
// driven by that revision's contract — a candidate's own document reports its API change as a tool one.
export function apiDocumentPath(environment = process.env) {
  return environment.COURTSIDE_SECURITY_API_DOCUMENT
    || fileURLToPath(new URL("../src/main/resources/api/openapi.yaml", import.meta.url));
}
