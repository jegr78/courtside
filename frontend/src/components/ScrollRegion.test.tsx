import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ScrollRegion } from "./ScrollRegion";

describe("ScrollRegion", () => {
  it("given a wide table, when it is wrapped, then the keyboard reaches the scroller and a screen reader hears its name", async () => {
    // given
    render(<>
      <h2 id="wide-heading">Hours</h2>
      <ScrollRegion labelledBy="wide-heading" testId="wide-scroll"><table><tbody><tr><td>08</td></tr></tbody></table></ScrollRegion>
    </>);

    // when
    await userEvent.tab();

    // then
    const region = screen.getByTestId("wide-scroll");
    expect(screen.getByRole("region"), "the scroller is a region").toBe(region);
    expect(region, "the region is named by its heading").toHaveAccessibleName("Hours");
    expect(region, "the scroller takes focus so arrow keys move the table").toHaveFocus();
  });
});
