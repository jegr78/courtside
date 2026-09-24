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

  it("given a light and a dark card colour, when the plan picks their label colours, then each takes the opposite tone", () => {
    // when / then
    expect(contrastColor("#d7e24b"), "a light card carries dark text").toBe("#0f172a");
    expect(contrastColor("#17211d"), "a dark card carries light text").toBe("#ffffff");
  });
});
