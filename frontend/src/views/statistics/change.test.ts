import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { changeOf } from "./change";
import { useStatisticsFormat } from "./format";

function format() {
  return renderHook(() => useStatisticsFormat()).result.current;
}

describe("changeOf", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("given a share that moved less than the shown tenth of a point, when compared, then it is unchanged", () => {
    // when
    const change = changeOf("ratio", 0.2504, 0.25, format());

    // then
    expect(change, "0.04 points round to zero").toEqual({ direction: "none" });
  });

  it("given a count that moved less than the shown tenth of a percent, when compared, then it is unchanged", () => {
    // when
    const change = changeOf("count", 10001, 10000, format());

    // then
    expect(change, "0.01 % rounds to zero").toEqual({ direction: "none" });
  });

  it("given a count that moved exactly the shown tenth of a percent, when compared, then it rose by it", () => {
    // when
    const change = changeOf("count", 1001, 1000, format());

    // then
    expect(change).toEqual({ direction: "up", value: "+0.1%" });
  });

  it("given a duration that fell by less than the shown tenth of a percent, when compared, then it is unchanged", () => {
    // when
    const change = changeOf("duration", 99999, 100000, format());

    // then
    expect(change, "a minute of 100000 rounds to zero").toEqual({ direction: "none" });
  });

  it("given a duration rising from nothing, when compared, then the absolute minutes are the change", () => {
    // when
    const change = changeOf("duration", 1, 0, format());

    // then
    expect(change).toEqual({ direction: "up", value: "+0:01" });
  });
});
