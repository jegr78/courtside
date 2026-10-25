import { describe, expect, it } from "vitest";
import de from "./de";
import en from "./en";

const bundles = { de: de as Record<string, string>, en: en as Record<string, string> };
const explicitPairs: [visible: string, accessible: string][] = [["booking.removeMemberShort", "booking.removeMember"]];

// The same tokens axe's label-content-name-mismatch compares: case, punctuation and parentheticals ignored.
function tokens(text: string) {
  return text.normalize("NFKD").replace(/\([^()]*\)/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
}

function contains(name: string, label: string) {
  const [haystack, needle] = [tokens(name), tokens(label)];
  return haystack.some((_, start) => needle.every((token, offset) => haystack[start + offset] === token));
}

function actionPairs(bundle: Record<string, string>) {
  const derived = Object.keys(bundle).filter((key) => key.endsWith("Accessible") && key.slice(0, -"Accessible".length) in bundle)
    .map((key): [string, string] => [key.slice(0, -"Accessible".length), key]);
  return [...derived, ...explicitPairs];
}

describe("action button names", () => {
  for (const [language, bundle] of Object.entries(bundles)) {
    it(`given the ${language} copy, when a button carries a longer accessible name, then that name contains the visible label`, () => {
      // given
      const pairs = actionPairs(bundle);

      // then
      expect(pairs.length, "the bundle has action buttons with accessible names").toBeGreaterThan(explicitPairs.length);
      expect(pairs.filter(([visible, accessible]) => !contains(bundle[accessible], bundle[visible]))
        .map(([visible, accessible]) => `${accessible} "${bundle[accessible]}" lacks ${visible} "${bundle[visible]}"`),
      "accessible names that do not contain their visible label").toEqual([]);
    });
  }
});
