import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const databases = [
  { name: "vulnerability", download: "--download-db-only", update: "--skip-db-update=false",
    repository: "--db-repository", sources: ["ghcr.io/aquasecurity/trivy-db:2", "mirror.gcr.io/aquasec/trivy-db:2"] },
  { name: "Java", download: "--download-java-db-only", update: "--skip-java-db-update=false",
    repository: "--java-db-repository", sources: ["ghcr.io/aquasecurity/trivy-java-db:1", "mirror.gcr.io/aquasec/trivy-java-db:1"] },
];

export function prepareTrivyDatabases({ cacheDir, execute = spawnSync }) {
  if (typeof cacheDir !== "string" || cacheDir.length === 0) throw new Error("Trivy cache directory is required");
  for (const database of databases) {
    const ready = database.sources.some((source) => {
      const result = execute("trivy", ["image", database.download, database.update,
        "--cache-dir", cacheDir, database.repository, source], { stdio: "inherit", timeout: 300_000 });
      return result.status === 0 && !result.error;
    });
    if (!ready) throw new Error(`${database.name} database is unavailable from every source`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: security-trivy-database.mjs <cache-directory>");
    prepareTrivyDatabases({ cacheDir: process.argv[2] });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
