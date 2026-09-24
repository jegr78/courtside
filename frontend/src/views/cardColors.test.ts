import { describe, expect, it } from "vitest";
import { cardContrast, contrastColor } from "./cardColors";

describe("cardContrast", () => {
  it("given a mid-tone card colour, when its label colour is chosen, then the better tone and its ratio are returned", () => {
    // when
    const contrast = cardContrast("#777777");

    // then
    expect(contrast).toMatchObject({ textColor: "#ffffff", tone: "light" });
    expect(contrast?.ratio, "even the better tone stays below 4.5:1").toBeCloseTo(4.48, 2);
  });

  it("given a card colour, when the plan picks its label colour, then it is the tone the contrast reading names", () => {
    // when / then
    expect(contrastColor("#d7e24b")).toBe(cardContrast("#d7e24b")?.textColor);
    expect(contrastColor("#17211d")).toBe(cardContrast("#17211d")?.textColor);
  });
});
