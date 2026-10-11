import { mkdirSync } from "node:fs";
import { test } from "@playwright/test";
import { loadConfig } from "../config/schema.mjs";
import { disposableFor } from "../config/disposables.mjs";

export type PersonaKey = "admin" | "trainer" | "youth" | "sport" | "grounds" | "treasurer" | "memberA" | "memberB" | "memberC" | "disposable";
export const config = loadConfig();
export const PASSWORD: string = config.password;
const run = process.env.ACCEPTANCE_RUN_DIR;
if (!run) throw new Error("ACCEPTANCE_RUN_DIR is not set; start the harness through acceptance/run.mjs");
export const RUN = run;
mkdirSync(RUN, { recursive: true });
export const runPath = (name: string) => `${RUN}/${name}`;
export const disposables: string[] = config.disposables;
const currentProject = () => { try { return test.info().project.name; } catch { return ""; } };
export const persona = (key: PersonaKey, project = currentProject()) =>
  ({ key, username: key === "disposable" ? disposableFor(project, disposables) as string : config.personas[key] as string });
export const stateKey = (key: PersonaKey, username = persona(key).username) =>
  key === "disposable" ? `disposable-${disposables.indexOf(username)}` : key;
