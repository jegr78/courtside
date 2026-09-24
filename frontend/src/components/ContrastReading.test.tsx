import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import { ContrastReading } from "./ContrastReading";

describe("ContrastReading", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("de");
  });

  it("given a German board, when a ratio is shown, then it is written with a decimal comma", () => {
    // when
    render(<ContrastReading contrast={{ textColor: "#ffffff", tone: "light", ratio: 5.061 }} testId="reading" />);

    // then
    expect(screen.getByTestId("reading")).toHaveTextContent("5,06:1");
  });

  it("given a ratio just below 4.5, when it is shown, then the printed figure does not claim 4.5", () => {
    // when
    render(<ContrastReading contrast={{ textColor: "#ffffff", tone: "light", ratio: 4.4996 }} testId="reading" />);

    // then
    expect(screen.getByTestId("reading"), "a failing ratio never prints as 4,50").toHaveTextContent("4,49:1");
    expect(screen.getByTestId("reading")).toHaveTextContent("erreicht 4,5:1 nicht");
  });
});
