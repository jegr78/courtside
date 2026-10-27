import { spawn } from "node:child_process";

export type ImageCommandResult = { exitCode: number | null; reason: string };
type ImageCommand = (args: string[], progress: boolean) => Promise<ImageCommandResult>;

export function runImageCommand(args: string[], progress: boolean): Promise<ImageCommandResult> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["ignore", progress ? "inherit" : "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8_192);
      if (progress) process.stderr.write(chunk);
    });
    child.once("error", (error) => resolve({ exitCode: null, reason: error.message }));
    child.once("close", (exitCode, signal) => resolve({ exitCode,
      reason: stderr.trim() || (signal ? `stopped by ${signal}` : `exit ${exitCode}`) }));
  });
}

export async function prepareBrowserImages(images: string[], { run = runImageCommand, log = console.error }:
  { run?: ImageCommand; log?: (message: string) => void } = {}): Promise<void> {
  for (const image of new Set(images)) {
    log(`Checking ${image}`);
    const inspected = await run(["image", "inspect", image], false);
    if (inspected.exitCode === 0) continue;
    if (inspected.exitCode !== 1 || !/(?:^|\n)(?:Error response from daemon: )?No such image:/.test(inspected.reason))
      throw new Error(`Could not inspect ${image}: ${inspected.reason}`);
    log(`Pulling ${image}`);
    const pulled = await run(["pull", image], true);
    if (pulled.exitCode !== 0) throw new Error(`Could not pull ${image}: ${pulled.reason}`);
  }
}
