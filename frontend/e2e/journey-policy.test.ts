import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { shortcutsTaken } from "./journey-policy";

const JOURNEYS = join(__dirname, "journeys");

const REACHES_PAST_THE_INTERFACE = [
  ["navigating by address", 'await page.goto("/bookings");'],
  ["writing without keystrokes", 'await page.getByTestId("username").fill("doe.jane");'],
  ["clicking regardless of the device", 'await page.getByTestId("sign-in-link").click();'],
  ["tapping regardless of the device", 'await page.getByTestId("sign-in-link").tap();'],
  ["running script in the page", 'await page.evaluate(() => localStorage.clear());'],
  ["raising an event the interface did not", 'element.dispatchEvent(new Event("input"));'],
  ["clicking past actionability", 'await activate(covered, { force: true });'],
  ["building the uploaded file in the test", 'await input.setInputFiles({ name: "m.csv", buffer: Buffer.from("a,b") });'],
  ["issuing its own requests", 'await page.request.post("/api/bookings", { data: {} });'],
  ["reading the mailbox itself", 'const messages = await fetch(`${mailbox}/api/v1/messages`);'],
  ["reaching the database", 'await executeSql("DELETE FROM booking");'],
  ["emptying a field without a keystroke", 'await page.getByTestId("person-first-name").clear();']
];

const A_MEMBER_COULD_DO_THIS = [
  ["entering through the one opening", "await openTheApplication(page);"],
  ["typing", 'await writeInto(page.getByTestId("username"), "doe.jane");'],
  ["typing over what was there", 'await rewrite(page.getByTestId("person-first-name"), "Mary");'],
  ["activating what is on the screen", 'await activate(page.getByTestId("sign-in-link"));'],
  ["choosing from a select the interface shows", 'await choose(page.locator("#locale-preference"), "en");'],
  ["choosing a file the picker would have chosen", 'await input.setInputFiles(fixturePath("members.csv"));'],
  ["reading the mail through the helper", 'const mail = await messageTo(mailboxURL, "jane.doe@example.org");'],
  ["waiting for what the screen says", 'await expect(page.getByTestId("court-plan-view")).toBeVisible();']
];

// The tiers are directories, so a reader that does not descend sees an empty catalogue and says
// every journey is clean.
function journeys(): string[] {
  return readdirSync(JOURNEYS, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".spec.ts"));
}

describe("the journey policy", () => {
  it("given the journey directory, when it is read, then it holds at least one journey", () => {
    // when / then
    expect(journeys().length).toBeGreaterThan(0);
  });

  it.each(REACHES_PAST_THE_INTERFACE)("given a journey %s, when the policy reads it, then it is refused",
    (_what, source) => {
      // when / then
      expect(shortcutsTaken(source)).not.toEqual([]);
    });

  it.each(A_MEMBER_COULD_DO_THIS)("given a journey %s, when the policy reads it, then it is allowed",
    (_what, source) => {
      // when / then
      expect(shortcutsTaken(source)).toEqual([]);
    });

  it("given every journey, when it is read, then none reaches past the interface", () => {
    // given
    const taken: string[] = [];

    // when
    for (const journey of journeys()) {
      const source = readFileSync(join(JOURNEYS, journey), "utf8");
      taken.push(...shortcutsTaken(source).map((refusal) => `${journey}: ${refusal}`));
    }

    // then
    expect(taken).toEqual([]);
  });
});
