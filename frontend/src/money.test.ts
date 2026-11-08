import { describe, expect, it } from "vitest";
import { formatMinor, formatSignedMinor, minorAsDecimal, parseMinor } from "./money";

describe("money", () => {
  it.each([["5", 500], ["5,50", 550], ["5.50", 550], ["0.29", 29], [" 12,5 ", 1250], ["0", 0]])(
    "given the amount %s typed by a board, when it is parsed for euros, then it is %i cents",
    (typed, cents) => {
      // when
      const parsed = parseMinor(typed, "EUR");

      // then
      expect(parsed).toBe(cents);
    });

  it.each([["-1"], ["5,505"], ["abc"], [""], ["5,5,0"], ["5.50 €"], ["1e3"]])(
    "given the amount %s, when it is parsed for euros, then it is refused",
    (typed) => {
      // when
      const parsed = parseMinor(typed, "EUR");

      // then
      expect(parsed, `${typed} is not an amount of euros`).toBeUndefined();
    });

  it("given a currency without a minor unit, when a fraction is typed, then it is refused", () => {
    // when
    const whole = parseMinor("500", "JPY");
    const fraction = parseMinor("500,5", "JPY");

    // then
    expect(whole).toBe(500);
    expect(fraction, "yen have no fraction digits").toBeUndefined();
  });

  it("given cents, when they are formatted for German and English, then each locale writes the amount its own way", () => {
    // when
    const german = formatMinor(1000, "de", "EUR");
    const english = formatMinor(500, "en", "EUR");

    // then
    expect(german).toBe("10,00 €");
    expect(english).toBe("€5.00");
  });

  it("given cents, when they are shown in an amount field, then the field holds a plain decimal in the locale's notation", () => {
    // when
    const german = minorAsDecimal(550, "de", "EUR");
    const english = minorAsDecimal(123456, "en", "EUR");

    // then
    expect(german).toBe("5,50");
    expect(english).toBe("1234.56");
    expect(parseMinor(german, "EUR")).toBe(550);
  });
  it("given a credit and a payout, when they are formatted signed, then each carries its direction and zero carries none", () => {
    // when
    const credit = formatSignedMinor(1250, "en", "EUR");
    const payout = formatSignedMinor(-500, "en", "EUR");
    const zero = formatSignedMinor(0, "en", "EUR");

    // then
    expect(credit).toBe("+€12.50");
    expect(payout).toBe("-€5.00");
    expect(zero).toBe("€0.00");
  });
});
