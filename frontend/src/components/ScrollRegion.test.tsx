import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { ScrollRegion } from "./ScrollRegion";

describe("ScrollRegion", () => {
  it("given a wide table, when it is wrapped, then the keyboard reaches the scroller and a screen reader hears it as that table", async () => {
    // given
    const tableName = i18n.t("table.scrollRegion", { name: "Hours" });
    render(<>
      <h2>Hours</h2>
      <ScrollRegion subject="Hours" testId="wide-scroll"><table><tbody><tr><td>08</td></tr></tbody></table></ScrollRegion>
    </>);

    // when
    await userEvent.tab();

    // then
    const region = screen.getByRole("region", { name: tableName });
    expect(region, "the scroller is the named region").toBe(screen.getByTestId("wide-scroll"));
    expect(tableName, "the region's name differs from the heading it sits under").not.toBe("Hours");
    expect(region, "the scroller takes focus so arrow keys move the table").toHaveFocus();
  });
});
