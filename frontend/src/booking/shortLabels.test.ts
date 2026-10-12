import { describe, expect, it } from "vitest";
import { MAXIMUM_SHORT_LABEL_LENGTH, shortLabels } from "./shortLabels";

function expectDistinctAndShort(codes: Map<string, string>) {
  const values = [...codes.values()];
  expect(values.every((code) => [...code].length <= MAXIMUM_SHORT_LABEL_LENGTH), `every code fits ${MAXIMUM_SHORT_LABEL_LENGTH} characters: ${values.join(", ")}`)
    .toBe(true);
  expect(new Set(values.map((code) => code.toLocaleLowerCase())).size, `no two labels share a code: ${values.join(", ")}`).toBe(values.length);
}

describe("shortLabels", () => {
  it("given the cards a German club ships, when shortening them, then each keeps its first three letters", () => {
    // when
    const codes = shortLabels(["Du", "Mitgliederbuchung", "Training", "Punktspiel", "Platz gesperrt", "Belegt"]);

    // then
    expect([...codes]).toEqual([
      ["Du", "Du"], ["Mitgliederbuchung", "Mit"], ["Training", "Tra"], ["Punktspiel", "Pun"], ["Platz gesperrt", "Pla"], ["Belegt", "Bel"]
    ]);
  });

  it("given cards that share a long first word, when shortening them, then each code is built from its word starts and stays within the cap", () => {
    // when
    const codes = shortLabels(["Training", "Training Herren", "Training Damen", "Training Jugend"]);

    // then
    expect([...codes]).toEqual([
      ["Training", "Trai"], ["Training Herren", "TrH"], ["Training Damen", "TrD"], ["Training Jugend", "TrJ"]
    ]);
    expectDistinctAndShort(codes);
  });

  it("given two labels sharing their opening letters, when shortening them, then they get distinct codes within the cap", () => {
    // when
    const codes = shortLabels(["Training", "trainer camp"]);

    // then
    expect(codes.get("Training"), "the comparison ignores case").toBe("Trai");
    expect(codes.get("trainer camp")).toBe("trc");
    expectDistinctAndShort(codes);
  });

  it("given a label that begins another, when shortening them, then both stay distinct", () => {
    // when
    const codes = shortLabels(["Court", "Court closed"]);

    // then
    expect([...codes]).toEqual([["Court", "Cour"], ["Court closed", "Coc"]]);
  });

  it("given the viewer word among the labels, when a card begins with it, then the card does not take the viewer's code", () => {
    // when
    const codes = shortLabels(["You", "Youth training"]);

    // then
    expect(codes.get("You")).toBe("You");
    expect(codes.get("Youth training"), "an own booking must not look like this card").toBe("Yout");
  });

  it("given a label of two letters and the same label twice, when shortening them, then the short one stays whole and the repeat gets one code", () => {
    // when
    const codes = shortLabels(["Ab", "Booked", "Booked"]);

    // then
    expect([...codes]).toEqual([["Ab", "Ab"], ["Booked", "Boo"]]);
  });

  it("given a prefix that ends in a space, when shortening the label, then the code carries no trailing space", () => {
    // when
    const codes = shortLabels(["Ten pairs", "Tennis"]);

    // then
    expect(codes.get("Ten pairs"), "a code ending in a space would read like the label it differs from").toBe("Tep");
    expect(codes.get("Tennis")).toBe("Tenn");
  });

  it("given labels whose word starts coincide too, when shortening them, then they are numbered within the cap", () => {
    // when
    const codes = shortLabels(["Team A one", "Team A other"]);

    // then
    expect([...codes]).toEqual([["Team A one", "Tea1"], ["Team A other", "Tea2"]]);
  });
});
