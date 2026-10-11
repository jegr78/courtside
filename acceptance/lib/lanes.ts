import { readFileSync } from "node:fs";
import { slotIn } from "../config/lanes.mjs";
import { zonedInstant } from "../config/calendar.mjs";
import { runPath } from "./context";

export type Slot = { profile: string; journey: string; date: string; court: number; start: string; end: string };
type Plan = { timeZone: string; days: string[]; saturday: string; sunday: string; slots: Slot[] };

let loaded: Plan | undefined;
// Discovery writes lanes.json after this module is first imported.
export const lanePlan = (): Plan => (loaded ??= JSON.parse(readFileSync(runPath("lanes.json"), "utf8")));
export const slotFor = (profile: string, journey: string): Slot => slotIn(lanePlan(), profile, journey);
export const allSlots = () => lanePlan().slots;
export const instantOf = (slot: Slot, edge: "start" | "end") => zonedInstant(slot.date, slot[edge], lanePlan().timeZone);
