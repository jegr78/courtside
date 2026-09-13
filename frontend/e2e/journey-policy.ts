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
  { pattern: /\bBuffer\b|\bbuffer\s*:/, why: "a journey hands the picker a fixture path; the file is not built in the test" },
  { pattern: /\brequest\s*\./, why: "state is built through the interface, not through the API" },
  { pattern: /\bfetch\s*\(/, why: "state is built through the interface, not through the API" },
  { pattern: /executeSql\s*\(/, why: "state is built through the interface, not through the database" }
];

export function shortcutsTaken(source: string): string[] {
  return SHORTCUTS.filter(({ pattern }) => pattern.test(source)).map(({ pattern, why }) => `${pattern.source} — ${why}`);
}
