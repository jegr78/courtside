import { mkdirSync } from "node:fs";
import { loadConfig } from "../config/schema.mjs";

export type PersonaKey = "admin" | "trainer" | "youth" | "sport" | "grounds" | "treasurer" | "memberA" | "memberB" | "memberC" | "disposable";
export const config = loadConfig();
export const PASSWORD: string = config.password;
const run = process.env.ACCEPTANCE_RUN_DIR;
if (!run) throw new Error("ACCEPTANCE_RUN_DIR is not set; start the harness through acceptance/run.mjs");
export const RUN = run;
mkdirSync(RUN, { recursive: true });
export const runPath = (name: string) => `${RUN}/${name}`;
export const persona = (key: PersonaKey) => ({ key, username: config.personas[key] as string });
