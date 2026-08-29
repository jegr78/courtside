import { describe, expect, it } from "vitest";
import { brandContrast } from "./brandColor";

describe("brandContrast", () => {
  it("given a mid-tone colour, when choosing its text, then the higher contrast tone and exact ratio are returned", () => {
    // when
    const contrast = brandContrast("#777777");

    // then
    expect(contrast).toMatchObject({ textColor: "#fcfbf9", tone: "light" });
    expect(contrast?.ratio).toBeCloseTo(4.33, 2);
  });

  it("given an incomplete colour, when evaluating it, then no misleading preview is produced", () => {
    // when
    const contrast = brandContrast("#777");

    // then
    expect(contrast).toBeUndefined();
  });
});
