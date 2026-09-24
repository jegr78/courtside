import { execFile } from "node:child_process";
import { promisify } from "node:util";

interface ProcessResult {
  stdout: string;
}

interface ProcessOptions {
  encoding: "utf8";
  maxBuffer: number;
}

export type ProcessExecutor = (
  command: string,
  args: readonly string[],
  options: ProcessOptions
) => Promise<ProcessResult>;

const executeFile = promisify(execFile) as unknown as ProcessExecutor;

export async function runJourneyProcess(
  command: string,
  args: readonly string[],
  execute: ProcessExecutor = executeFile
): Promise<string> {
  return (await execute(command, args, { encoding: "utf8", maxBuffer: 1024 * 1024 })).stdout;
}
