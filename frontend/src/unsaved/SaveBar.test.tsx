import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { SaveBar } from "./SaveBar";
import { UnsavedChangesProvider } from "./UnsavedChangesProvider";
import { useUnsavedChanges } from "./registry";

function Count() {
  const { unsavedCount } = useUnsavedChanges();
  return <output data-testid="count">{unsavedCount}</output>;
}

function bar(props: Partial<Parameters<typeof SaveBar>[0]> = {}) {
  const save = vi.fn();
  const discard = vi.fn();
  render(<UnsavedChangesProvider>
    <SaveBar id="opening-hours" subject="Opening hours" saveTestId="save-opening-hours"
             unsaved pending={false} save={save} discard={discard} {...props} />
    <Count />
  </UnsavedChangesProvider>);
  return { save, discard };
}

beforeEach(async () => { await i18n.changeLanguage("en"); });

it("given nothing is unsaved, when the page renders, then there is no bar and nothing to lose", () => {
  // when
  bar({ unsaved: false });

  // then
  expect(screen.queryByTestId("save-bar"), "a clean page shows no bar").toBeNull();
  expect(screen.getByTestId("count")).toHaveTextContent("0");
});

it("given unsaved work, when the page renders, then the bar names what it saves and counts once", () => {
  // when
  bar();

  // then
  expect(screen.getByTestId("unsaved-mark-opening-hours")).toHaveTextContent("Not saved yet: Opening hours");
  expect(screen.getByTestId("save-opening-hours")).toHaveAttribute("aria-describedby", "unsaved-mark-opening-hours");
  expect(screen.getByTestId("count"), "one page save is one change to lose").toHaveTextContent("1");
});

it("given unsaved work, when saving, then the page's save runs", async () => {
  // given
  const { save, discard } = bar();

  // when
  await userEvent.click(screen.getByTestId("save-opening-hours"));

  // then
  expect(save).toHaveBeenCalledOnce();
  expect(discard).not.toHaveBeenCalled();
});

it("given unsaved work, when discarding, then the page's discard runs", async () => {
  // given
  const { save, discard } = bar();

  // when
  await userEvent.click(screen.getByTestId("discard-opening-hours"));

  // then
  expect(discard).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
});

it("given a save in flight, when the bar renders, then neither answer can be given twice", () => {
  // when
  bar({ pending: true });

  // then
  expect(screen.getByTestId("save-opening-hours")).toBeDisabled();
  expect(screen.getByTestId("discard-opening-hours")).toBeDisabled();
});

it("given the page is one form, when the bar renders, then its save submits that form", () => {
  // when
  bar({ form: "opening-hours-form" });

  // then
  expect(screen.getByTestId("save-opening-hours")).toHaveAttribute("type", "submit");
  expect(screen.getByTestId("save-opening-hours")).toHaveAttribute("form", "opening-hours-form");
});
