import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import i18n from "../i18n";
import { DateTimeInput } from "./DateTimeInput";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

it("given an empty time field, when it renders, then it is marked empty and described as not set", () => {
  // when
  render(<DateTimeInput data-testid="starts" type="time" aria-label="Starts" value="" onChange={() => {}} />);

  // then
  const field = screen.getByTestId("starts");
  expect(field, "the stylesheet hides the browser's ghost value by this mark").toHaveAttribute("data-empty", "true");
  expect(field, "assistive technology hears that nothing is set").toHaveAccessibleDescription("Not set");
  expect(field, "the hint does not become part of the name").toHaveAccessibleName("Starts");
  expect(screen.getByTestId("starts-empty"), "sighted users see the same hint").toHaveTextContent("Not set");
});

it("given a field with a value, when it renders, then it carries neither the mark nor the hint", () => {
  // when
  render(<DateTimeInput data-testid="starts" type="datetime-local" aria-label="Starts" value="2026-10-03T12:30" onChange={() => {}} />);

  // then
  const field = screen.getByTestId("starts");
  expect(field, "a set value is shown as it is").not.toHaveAttribute("data-empty");
  expect(field).not.toHaveAccessibleDescription();
  expect(screen.queryByTestId("starts-empty")).not.toBeInTheDocument();
});

it("given an empty field nobody controls, when a date is entered, then the mark and the hint go", () => {
  // given
  render(<DateTimeInput data-testid="starts" type="date" aria-label="Starts" />);
  const field = screen.getByTestId("starts");

  // when
  fireEvent.change(field, { target: { value: "2026-10-03" } });

  // then
  expect(field, "an entered date is no longer empty").not.toHaveAttribute("data-empty");
  expect(screen.queryByTestId("starts-empty")).not.toBeInTheDocument();
});

it("given a field with a description of its own, when it is empty, then both descriptions reach assistive technology", () => {
  // given
  render(<>
    <p id="starts-error">Choose a later time</p>
    <DateTimeInput data-testid="starts" type="time" aria-label="Starts" aria-describedby="starts-error" value="" onChange={() => {}} />
  </>);

  // then
  expect(screen.getByTestId("starts"), "the empty hint joins the field's own description").toHaveAccessibleDescription("Choose a later time Not set");
});

it("given German, when an empty field renders, then the hint is German", async () => {
  // given
  await i18n.changeLanguage("de");

  // when
  render(<DateTimeInput data-testid="starts" type="time" aria-label="Beginn" value="" onChange={() => {}} />);

  // then
  expect(screen.getByTestId("starts")).toHaveAccessibleDescription("Nicht gesetzt");
});
