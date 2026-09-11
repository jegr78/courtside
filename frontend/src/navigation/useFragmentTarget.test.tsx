import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useFragmentTarget } from "./useFragmentTarget";

function Target({ fragment }: { fragment: string }) {
  useFragmentTarget("wanted", true);
  return <>
    <div id="wanted" tabIndex={-1} data-testid={`wanted-${fragment}`} />
    <div id="other" tabIndex={-1} />
  </>;
}

function show(fragment: string) {
  render(<MemoryRouter initialEntries={[`/somewhere${fragment}`]}><Target fragment={fragment} /></MemoryRouter>);
}

describe("useFragmentTarget", () => {
  it("given a fragment naming another element, when the target is ready, then nothing takes the focus", () => {
    // given / when
    for (const fragment of ["#other", "#Wanted", "#wanted ", "#wanted2", "#", "?wanted"]) {
      cleanup();
      show(fragment);

      // then
      expect(document.activeElement).toBe(document.body);
    }
  });

  it("given the fragment naming the target, when it is ready, then the target takes the focus", () => {
    // given / when
    show("#wanted");

    // then
    expect(document.activeElement).toBe(document.getElementById("wanted"));
  });
});
