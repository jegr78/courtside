import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { DateTimeInput } from "./DateTimeInput";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

it("given an empty time field, when it renders, then it is marked empty and described as not set", () => {
  // when
  render(<DateTimeInput data-testid="starts" type="time" aria-label="Starts" value="" onValueChange={() => {}} />);

  // then
  const field = screen.getByTestId("starts");
  expect(field, "the stylesheet hides the browser's ghost value by this mark").toHaveAttribute("data-empty", "true");
  expect(field, "assistive technology hears that nothing is set").toHaveAccessibleDescription("Not set Example: 04:05 PM");
  expect(field, "the hint does not become part of the name").toHaveAccessibleName("Starts");
  expect(screen.getByTestId("starts-empty"), "sighted users see the same hint").toHaveTextContent("Not set");
});

it("given a field with a value, when it renders, then it carries neither the mark nor the hint", () => {
  // when
  render(<DateTimeInput data-testid="starts" type="datetime-local" aria-label="Starts" value="2026-10-03T12:30" onValueChange={() => {}} />);

  // then
  const field = screen.getByTestId("starts");
  expect(field, "a set value is shown as it is").not.toHaveAttribute("data-empty");
  expect(field, "a set value is not described as not set").toHaveAccessibleDescription("Example: 11/22/2006 04:05 PM");
  expect(screen.queryByTestId("starts-empty"), "a set value shows no empty hint").not.toBeInTheDocument();
});

it("given an empty field nobody controls, when a date is entered, then the mark and the hint go", () => {
  // given
  render(<DateTimeInput data-testid="starts" type="date" aria-label="Starts" />);
  const field = screen.getByTestId("starts");

  // when
  fireEvent.change(field, { target: { value: "2026-10-03" } });

  // then
  expect(field, "an entered date is no longer empty").not.toHaveAttribute("data-empty");
  expect(screen.queryByTestId("starts-empty"), "an entered date removes the empty hint").not.toBeInTheDocument();
});

it("given a field with a description of its own, when it is empty, then both descriptions reach assistive technology", () => {
  // given
  render(<>
    <p id="starts-error">Choose a later time</p>
    <DateTimeInput data-testid="starts" type="time" aria-label="Starts" aria-describedby="starts-error" value="" onValueChange={() => {}} />
  </>);

  // then
  expect(screen.getByTestId("starts"), "the empty hint joins the field's own description").toHaveAccessibleDescription("Choose a later time Not set Example: 04:05 PM");
});

it("given German, when an empty field renders, then the hint is German", async () => {
  // given
  await i18n.changeLanguage("de");

  // when
  render(<DateTimeInput data-testid="starts" type="time" aria-label="Beginn" value="" onValueChange={() => {}} />);

  // then
  expect(screen.getByTestId("starts"), "the default locale announces the empty state in German").toHaveAccessibleDescription("Nicht gesetzt Beispiel: 16:05");
});

it("given a hint of its own, when the field is empty, then that hint is shown and announced instead", () => {
  // when
  render(<DateTimeInput data-testid="starts" type="time" aria-label="Starts" emptyHint="Unchanged" value="" onValueChange={() => {}} />);

  // then
  expect(screen.getByTestId("starts"), "the caller's meaning of empty is announced").toHaveAccessibleDescription("Unchanged Example: 04:05 PM");
  expect(screen.getByTestId("starts-empty"), "the caller's meaning of empty is shown").toHaveTextContent("Unchanged");
});

it("given German values, when editing and blurring, then the visible draft stays localized and callbacks carry ISO", async () => {
  // given
  await i18n.changeLanguage("de");
  const changed = vi.fn();
  render(<DateTimeInput data-testid="starts" type="date" defaultValue="2026-10-03" onValueChange={changed} />);
  const field = screen.getByTestId("starts");
  expect(field).toHaveValue("03.10.2026");

  // when
  fireEvent.change(field, { target: { value: "29.02." } });
  fireEvent.blur(field);

  // then
  expect(field).toHaveValue("29.02.");
  expect(field).toBeInvalid();
  expect(changed).toHaveBeenLastCalledWith("");

  // when
  fireEvent.change(field, { target: { value: "29.02.2028" } });
  fireEvent.blur(field);

  // then
  expect(field).toHaveValue("29.02.2028");
  expect(changed).toHaveBeenLastCalledWith("2028-02-29");
  expect(field).toBeValid();
});

it("given a named default date, when a form is edited and reset, then FormData and the editor retain their distinct formats", async () => {
  // given
  await i18n.changeLanguage("de");
  render(<form data-testid="form"><DateTimeInput data-testid="starts" name="starts" type="date" defaultValue="2026-10-03" required /></form>);
  const field = screen.getByTestId("starts");
  const form = screen.getByTestId<HTMLFormElement>("form");

  // when
  fireEvent.change(field, { target: { value: "04.10.2026" } });

  // then
  expect(new FormData(form).get("starts")).toBe("2026-10-04");
  expect(field).toHaveValue("04.10.2026");

  // when
  fireEvent.reset(form);

  // then
  expect(field).toHaveValue("03.10.2026");
  expect(new FormData(form).get("starts")).toBe("2026-10-03");
});

it("given bounds and a minute step, when invalid drafts or out-of-range times are entered, then form submission is blocked", async () => {
  // given
  await i18n.changeLanguage("de");
  render(<form data-testid="form"><DateTimeInput data-testid="starts" name="starts" type="time" required min="08:00" max="18:00" step={900} /></form>);
  const field = screen.getByTestId("starts");
  const form = screen.getByTestId<HTMLFormElement>("form");

  // when / then
  for (const value of ["", " ", "0", "25:00", "07:45", "18:15", "08:01"]) {
    fireEvent.change(field, { target: { value } });
    expect(form.checkValidity(), value).toBe(false);
  }
  fireEvent.change(field, { target: { value: "08:15" } });
  expect(form.checkValidity()).toBe(true);
  expect(new FormData(form).get("starts")).toBe("08:15");
});

it("given a controlled wall value, when the language or parent value changes, then only the visible format changes", async () => {
  // given
  const changed = vi.fn();
  const view = render(<DateTimeInput data-testid="starts" type="datetime-local" value="2026-10-03T16:05" onValueChange={changed} />);
  const field = screen.getByTestId("starts");
  expect(field).toHaveValue("10/03/2026 04:05 PM");

  // when
  await i18n.changeLanguage("de");

  // then
  expect(field).toHaveValue("03.10.2026 16:05");
  expect(changed).not.toHaveBeenCalled();

  // when
  view.rerender(<DateTimeInput data-testid="starts" type="datetime-local" value="2028-02-29T00:00" onValueChange={changed} />);

  // then
  expect(field).toHaveValue("29.02.2028 00:00");
});

it("given a partial draft, when language changes and the parent rerenders, then typed digits remain", async () => {
  // given
  const view = render(<DateTimeInput data-testid="starts" type="date" value="" />);
  const field = screen.getByTestId("starts");
  fireEvent.change(field, { target: { value: "10/" } });

  // when
  await i18n.changeLanguage("de");
  view.rerender(<DateTimeInput data-testid="starts" type="date" value="" />);

  // then
  expect(field).toHaveValue("10/");
  expect(field).toBeInvalid();
  expect(field).not.toHaveAttribute("data-empty");
});

it("given named optional and disabled fields, when a value is cleared, then only enabled ISO values enter FormData", () => {
  // given
  render(<form data-testid="form"><DateTimeInput data-testid="starts" type="time" name="starts" defaultValue="16:05" />
    <DateTimeInput data-testid="locked" type="date" name="locked" defaultValue="2026-10-03" disabled />
    <DateTimeInput data-testid="read-only" type="date" name="fixed" defaultValue="2026-10-03" readOnly /></form>);
  const form = screen.getByTestId<HTMLFormElement>("form");

  // when
  fireEvent.change(screen.getByTestId("starts"), { target: { value: "" } });

  // then
  expect(new FormData(form).get("starts")).toBe("");
  expect(new FormData(form).has("locked")).toBe(false);
  expect(new FormData(form).get("fixed")).toBe("2026-10-03");
  expect(screen.getByTestId("read-only")).toHaveAttribute("readonly");
  expect(form.checkValidity()).toBe(true);

  // when
  fireEvent.change(screen.getByTestId("starts"), { target: { value: " " } });

  // then
  expect(form.checkValidity()).toBe(true);
  expect(new FormData(form).get("starts")).toBe("");
});

it("given seconds and step constraints, when a fractional time is edited, then ISO precision survives blur", async () => {
  // given
  await i18n.changeLanguage("de");
  const changed = vi.fn();
  render(<form data-testid="form"><DateTimeInput data-testid="starts" name="starts" type="time" step={0.125} defaultValue="12:30:00.125" onValueChange={changed} /></form>);
  const field = screen.getByTestId("starts");

  // when
  fireEvent.change(field, { target: { value: "12:30:00.250" } });
  fireEvent.blur(field);

  // then
  expect(field).toHaveValue("12:30:00.250");
  expect(field).toBeValid();
  expect(changed).toHaveBeenLastCalledWith("12:30:00.250");
  expect(new FormData(screen.getByTestId<HTMLFormElement>("form")).get("starts")).toBe("12:30:00.250");
});

it("given localized editing callbacks, when input and blur fire, then DOM events belong to the visible editor and the value callback carries ISO", async () => {
  // given
  await i18n.changeLanguage("de");
  const targets: EventTarget[] = [];
  const changed = vi.fn();
  render(<DateTimeInput data-testid="starts" type="date" onValueChange={changed}
    onInput={(event) => targets.push(event.currentTarget)} onBlur={(event) => targets.push(event.currentTarget)} />);
  const field = screen.getByTestId("starts");

  // when
  fireEvent.input(field, { target: { value: "03.10.2026" } });
  fireEvent.blur(field);

  // then
  expect(targets).toEqual([field, field]);
  expect(changed).toHaveBeenLastCalledWith("2026-10-03");
  expect(field).toHaveValue("03.10.2026");
});

it("given date and datetime constraints, when a bound or step is crossed, then strict wall values determine validity", async () => {
  // given
  await i18n.changeLanguage("de");
  render(<><DateTimeInput data-testid="date" type="date" min="2028-02-28" max="2028-03-03" step={2} />
    <DateTimeInput data-testid="datetime" type="datetime-local" min="2028-02-29T09:00" max="2028-02-29T10:00" step={900} /></>);
  const date = screen.getByTestId("date");
  const datetime = screen.getByTestId("datetime");

  // when / then
  for (const value of ["27.02.2028", "29.02.2028", "04.03.2028"]) {
    fireEvent.change(date, { target: { value } });
    expect(date, value).toBeInvalid();
  }
  fireEvent.change(date, { target: { value: "01.03.2028" } });
  expect(date).toBeValid();
  for (const value of ["29.02.2028 08:45", "29.02.2028 09:01", "29.02.2028 10:15"]) {
    fireEvent.change(datetime, { target: { value } });
    expect(datetime, value).toBeInvalid();
  }
  fireEvent.change(datetime, { target: { value: "29.02.2028 09:15" } });
  expect(datetime).toBeValid();
});

it("given a parent that ignores empty values, when a draft is edited and external values arrive, then typing survives while external changes replace it", async () => {
  // given
  const user = userEvent.setup();
  const view = render(<DateTimeInput data-testid="starts" type="date" value="2026-10-03" onValueChange={() => undefined} />);
  const field = screen.getByTestId("starts");

  // when
  await user.clear(field);
  await user.type(field, "1");

  // then
  expect(field).toHaveValue("1");

  // when
  view.rerender(<DateTimeInput data-testid="starts" type="date" value="2028-02-29" />);

  // then
  expect(field).toHaveValue("02/29/2028");

  // when
  await user.clear(field);
  await user.type(field, "0");
  view.rerender(<DateTimeInput data-testid="starts" type="date" value="" />);

  // then
  expect(field).toHaveValue("");
});
