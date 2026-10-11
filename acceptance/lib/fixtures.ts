import { test as base, expect } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { apiAs } from "./api";
import { slotFor, type Slot } from "./lanes";
import { runPath } from "./context";
import { precondition } from "./precondition";
import { sweep } from "./sweep";

const record = (row: object) => appendFileSync(runPath("sweeps.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n");

export const test = base.extend<{ lanes: { take: (journey: string) => Promise<Slot> } }>({
  lanes: async ({ browser }, use, info) => {
    const admin = await apiAs("admin");
    const taken: Slot[] = [];
    await use({
      take: async (journey) => {
        const slot = slotFor(info.project.name, journey);
        taken.push(slot);
        const { removed, left, foreign } = await sweep(admin, [slot]);
        record({ phase: "before", project: info.project.name, test: info.title, removed, left, foreign });
        precondition(foreign.length === 0, `slot ${journey} ${slot.date} ${slot.start} court ${slot.court} holds a booking of the club: ${foreign.map((f) => f.id).join(", ")}`);
        precondition(left.length === 0, `slot ${journey} ${slot.date} ${slot.start} court ${slot.court} could not be cleared`);
        return slot;
      }
    });
    // An abandoned test may still be sending requests: close its contexts, then sweep twice.
    for (const context of browser.contexts()) await context.close().catch(() => undefined);
    const first = await sweep(admin, taken);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const second = await sweep(admin, taken);
    record({ phase: "after", project: info.project.name, test: info.title, status: info.status,
      removed: [...first.removed, ...second.removed], left: second.left, foreign: second.foreign });
    await admin.dispose();
  }
});
export { expect };
