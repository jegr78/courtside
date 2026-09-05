import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { ImportProgress } from "./ImportProgress";
import type { ImportStep } from "./steps";

function show(current: ImportStep, reached: ImportStep[], goTo = vi.fn()) {
  render(<ImportProgress current={current} reached={reached} goTo={goTo} />);
  return goTo;
}

describe("ImportProgress", () => {

  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("when the steps are shown, then the region carries a name a screen reader can announce", () => {
    // when
    show("source", []);

    // then
    expect(screen.getByTestId("import-progress"))
      .toHaveAttribute("aria-label", i18n.t("admin.import.progress"));
  });

  it("given a step nobody has reached, when the board tries it, then the import does not skip ahead", async () => {
    // given
    const goTo = show("source", []);

    // when
    await userEvent.click(screen.getByTestId("import-step-execution"));

    // then
    expect(goTo).not.toHaveBeenCalled();
  });

  it("given a step already reached, when the board chooses it, then the import is asked to go there", async () => {
    // given
    const goTo = show("execution", ["source", "preview"]);

    // when
    await userEvent.click(screen.getByTestId("import-step-source"));

    // then
    expect(goTo).toHaveBeenCalledWith("source");
  });
});
