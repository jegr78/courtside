import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { config, runPath } from "./context";
import { erasedCount, erasureCommand } from "./core.mjs";
import { findExecutable } from "./executable.mjs";
import { precondition } from "./precondition";

export function runSql(sql: string, file: string) {
  writeFileSync(runPath(file), sql);
  precondition(config.erasure, `no erasure path is configured, so ${file} cannot be applied`);
  const [program, args] = erasureCommand(config.erasure) as [string, string[]];
  const executable = findExecutable(program);
  precondition(executable, `${program} is not on PATH, so ${file} is not applied`);
  const result = spawnSync(executable, args, { input: sql, encoding: "utf8", timeout: 60_000 });
  precondition(result.status === 0, `${file} exited ${result.status}: ${(result.stderr ?? "").slice(0, 300)}`);
  return result.stdout ?? "";
}

export function erase(sql: string | null, file: string) {
  if (!sql) return { attempted: false };
  writeFileSync(runPath(file), sql);
  if (!config.erasure) return { attempted: false, sql: file };
  const [program, args] = erasureCommand(config.erasure) as [string, string[]];
  const executable = findExecutable(program);
  precondition(executable, `${program} is not on PATH, so ${file} is not applied`);
  const result = spawnSync(executable, args, { input: sql, encoding: "utf8", timeout: 60_000 });
  return { attempted: true, exit: result.status, erased: erasedCount(result.stdout ?? "") };
}
