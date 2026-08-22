import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { comparisonSummary, unacknowledgedFindings } from "./security-tool-comparison.mjs";

// The comparison itself is produced by the protected base's comparator, whose arguments this must
// not change. Reading its output afterwards is what turns a difference into something somebody saw.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [comparisonOption, comparisonFile, acknowledgementOption, acknowledgementFile,
    summaryOption, summaryFile] = process.argv.slice(2);
  if (comparisonOption !== "--comparison" || acknowledgementOption !== "--acknowledgement"
      || summaryOption !== "--summary" || !comparisonFile || !acknowledgementFile || !summaryFile) {
    process.stderr.write("Usage: security-tool-acknowledgement.mjs --comparison <file>"
      + " --acknowledgement <file> --summary <file>\n");
    process.exit(1);
  }
  const comparison = JSON.parse(readFileSync(comparisonFile, "utf8"));
  writeFileSync(summaryFile, comparisonSummary(comparison), { mode: 0o600 });
  const unacknowledged = unacknowledgedFindings(comparison,
    JSON.parse(readFileSync(acknowledgementFile, "utf8")));
  if (unacknowledged.length > 0) {
    process.stderr.write(`The comparison changed findings nobody recorded: ${unacknowledged.join(", ")}.\n`
      + `Read what changed, then record them in ${acknowledgementFile}.\n`);
    process.exit(1);
  }
}
