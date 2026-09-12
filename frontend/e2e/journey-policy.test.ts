import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const JOURNEYS = join(__dirname, "journeys");

// A journey is the record of what a member can do, so it may only do what a member could. Each of
// these reaches past the interface into the page, the network or Playwright's own escape hatches.
const SHORTCUTS = [
  { pattern: /\.goto\s*\(/, why: "navigate by activating what is on the screen; openTheApplication is the one entry" },
  { pattern: /\.fill\s*\(/, why: "writeInto sends keystrokes, fill replaces them with one input event" },
  { pattern: /\.click\s*\(/, why: "activate clicks or taps according to the device the journey runs on" },
  { pattern: /\.tap\s*\(/, why: "activate clicks or taps according to the device the journey runs on" },
  { pattern: /\.evaluate\s*\(/, why: "a member cannot run script in the page" },
  { pattern: /dispatchEvent\s*\(/, why: "a member cannot raise an event the interface did not" },
  { pattern: /force\s*:\s*true/, why: "force skips the checks that refuse a covered or disabled control" },
  { pattern: /\.setInputFiles\s*\(/, why: "an upload belongs to a journey that opens the picker" },
  { pattern: /\brequest\s*\./, why: "state is built through the interface, not through the API" },
  { pattern: /\bfetch\s*\(/, why: "state is built through the interface, not through the API" },
  { pattern: /executeSql\s*\(/, why: "state is built through the interface, not through the database" }
];

function journeys(): string[] {
  return readdirSync(JOURNEYS).filter((name) => name.endsWith(".spec.ts"));
}

describe("the journey policy", () => {
  it("given the journey directory, when it is read, then it holds at least one journey", () => {
    // when / then
    expect(journeys().length).toBeGreaterThan(0);
  });

  it("given every journey, when it is read, then none reaches past the interface", () => {
    // given
    const taken: string[] = [];

    // when
    for (const journey of journeys()) {
      const source = readFileSync(join(JOURNEYS, journey), "utf8");
      for (const { pattern, why } of SHORTCUTS) {
        if (pattern.test(source)) taken.push(`${journey}: ${pattern.source} — ${why}`);
      }
    }

    // then
    expect(taken).toEqual([]);
  });
});
