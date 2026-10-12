import { describe, expect, it } from "vitest";
import { shortLabels } from "./shortLabels";

describe("shortLabels", () => {
  it("given the cards a German club ships, when shortening them, then each keeps its first three letters", () => {
    // when
    const codes = shortLabels(["Mitgliederbuchung", "Training", "Punktspiel", "Platz gesperrt", "Belegt"]);

    // then
    expect([...codes]).toEqual([
      ["Mitgliederbuchung", "Mit"], ["Training", "Tra"], ["Punktspiel", "Pun"], ["Platz gesperrt", "Pla"], ["Belegt", "Bel"]
    ]);
  });

  it("given two labels sharing their opening letters, when shortening them, then each grows until it differs from the other", () => {
    // when
    const codes = shortLabels(["Training", "trainer camp"]);

    // then
    expect(codes.get("Training"), "the comparison ignores case").toBe("Traini");
    expect(codes.get("trainer camp")).toBe("traine");
  });

  it("given a label that begins another, when shortening them, then the shorter one stays whole", () => {
    // when
    const codes = shortLabels(["Court", "Court closed"]);

    // then
    expect(codes.get("Court"), "no prefix of a label that begins another can tell them apart").toBe("Court");
    expect(codes.get("Court closed")).toBe("Court c");
  });

  it("given a label of two letters and the same label twice, when shortening them, then the short one stays whole and the repeat gets one code", () => {
    // when
    const codes = shortLabels(["Ab", "Booked", "Booked"]);

    // then
    expect([...codes]).toEqual([["Ab", "Ab"], ["Booked", "Boo"]]);
  });

  it("given a prefix that ends in a space, when shortening the label, then the code carries no trailing space", () => {
    // when
    const codes = shortLabels(["Platz gesperrt", "Platz frei"]);

    // then
    expect(codes.get("Platz gesperrt")).toBe("Platz g");
    expect(codes.get("Platz frei")).toBe("Platz f");
  });
});
