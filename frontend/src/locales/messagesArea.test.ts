import { describe, expect, it } from "vitest";
import de from "./de";
import en from "./en";

const languages = [
  { bundle: de as Record<string, string>, area: "Nachrichten", notice: "Benachrichtigung", pointers: {
    "myMessages.channelsReason": "neben Nachrichten im Menü",
    "waitlist.explanation": "unter Nachrichten",
    "guardianGrant.READ_MESSAGES": "Nachrichten"
  } },
  { bundle: en as Record<string, string>, area: "Messages", notice: "notification", pointers: {
    "myMessages.channelsReason": "beside Messages in the menu",
    "waitlist.explanation": "in Messages",
    "guardianGrant.READ_MESSAGES": "messages"
  } }
];

describe("messages area copy", () => {
  for (const { bundle, area, notice, pointers } of languages) {
    it(`given the ${area} copy, when the area is named, then the navigation, the compact tab and the page say ${area}`, () => {
      // then
      for (const key of ["nav.myMessages", "nav.myMessagesCompact", "myMessages.title", "dependants.messages"]) {
        expect(bundle[key], `${key} names the area`).toBe(area);
      }
      for (const key of ["nav.myMessagesUnread_one", "nav.myMessagesUnread_other"]) {
        expect(bundle[key], `${key} names the area`).toMatch(new RegExp(`^${area}, `));
      }
    });

    it(`given the ${area} copy, when a text points to the area, then it calls it ${area} and not by the word for one notice`, () => {
      // then
      for (const [key, phrase] of Object.entries(pointers)) {
        expect(bundle[key], `${key} points to the area`).toContain(phrase);
        expect(bundle[key], `${key} calls the area by its name`).not.toMatch(new RegExp(`${notice}s|${notice}en`, "i"));
      }
    });
  }
});
