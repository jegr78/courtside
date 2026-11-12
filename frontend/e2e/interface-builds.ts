import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { build, type Plugin } from "vite";

export interface InterfaceBuild {
  directory: string;
  index: string;
  adminRoutes: string;
  adminPage: string;
}

function bundle(directory: string, chunk: "index" | "AdminRoutes" | "AdminOverviewView"): string {
  const folder = chunk === "index" ? "assets" : "assets/admin";
  const found = readdirSync(resolve(directory, folder)).filter((file) => file.startsWith(`${chunk}-`) && file.endsWith(".js"));
  if (found.length !== 1) throw new Error(`The interface build in ${directory} holds ${found.length} ${chunk} bundles`);
  return found[0];
}

export function interfaceBundles(directory: string): InterfaceBuild {
  return { directory, index: bundle(directory, "index"), adminRoutes: bundle(directory, "AdminRoutes"),
    adminPage: bundle(directory, "AdminOverviewView") };
}

function marked(variant: string): Plugin {
  return {
    name: "courtside-interface-variant",
    transform(code, id) {
      return /src\/(main|views\/AdminRoutes|views\/AdminOverviewView)\.tsx$/.test(id)
        ? `${code}\nglobalThis.courtsideInterfaceVariant = ${JSON.stringify(variant)};\n`
        : undefined;
    }
  };
}

// Each variant changes the entry, the admin router and one admin page, so their hashes move as in a real release.
export async function buildInterface(variant: string, version: string | undefined, directory: string): Promise<InterfaceBuild> {
  await build({
    configFile: resolve("vite.config.ts"),
    logLevel: "error",
    define: version ? { __COURTSIDE_APP_VERSION__: JSON.stringify(version) } : {},
    plugins: [marked(variant)],
    build: { outDir: directory, emptyOutDir: true }
  });
  return interfaceBundles(directory);
}
