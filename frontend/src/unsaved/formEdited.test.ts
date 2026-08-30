import { expect, it } from "vitest";
import { formEdited } from "./formEdited";

function form(markup: string): HTMLFormElement {
  document.body.innerHTML = `<form>${markup}</form>`;
  return document.body.querySelector("form") as HTMLFormElement;
}

it("given an untouched form, when reading it, then it holds nothing", () => {
  // then
  expect(formEdited(form(`<input name="label"><input name="colour" type="color" value="#b85c38">`))).toBe(false);
});

it("given a field typed into, when reading the form, then it holds work", () => {
  // given
  const filled = form(`<input name="label">`);
  (filled.elements.namedItem("label") as HTMLInputElement).value = "Ball machine";

  // then
  expect(formEdited(filled)).toBe(true);
});

// The colour picker keeps its default while the one field somebody typed into is cleared again.
it("given a typed field emptied again, when reading the form, then it holds nothing", () => {
  // given
  const filled = form(`<input name="label"><input name="colour" type="color" value="#b85c38">`);
  const label = filled.elements.namedItem("label") as HTMLInputElement;
  label.value = "Ball machine";
  label.value = "";

  // then
  expect(formEdited(filled)).toBe(false);
});

it("given a ticked checkbox, when reading the form, then it holds work", () => {
  // given
  const ticked = form(`<input name="guests" type="checkbox">`);
  (ticked.elements.namedItem("guests") as HTMLInputElement).checked = true;

  // then
  expect(formEdited(ticked)).toBe(true);
});

// Nothing carries the selected attribute, so the first option is what a reset would restore.
it("given a select left on its first option, when reading the form, then it holds nothing", () => {
  // then
  expect(formEdited(form(`<select name="rules"><option value="a"></option><option value="b"></option></select>`)))
    .toBe(false);
});

it("given a select moved off its first option, when reading the form, then it holds work", () => {
  // given
  const chosen = form(`<select name="rules"><option value="a"></option><option value="b"></option></select>`);
  (chosen.elements.namedItem("rules") as HTMLSelectElement).value = "b";

  // then
  expect(formEdited(chosen)).toBe(true);
});

it("given a select moved back to the option it was preselected on, when reading the form, then it holds nothing", () => {
  // given
  const chosen = form(`<select name="rules"><option value="a"></option><option value="b" selected></option></select>`);
  const select = chosen.elements.namedItem("rules") as HTMLSelectElement;
  select.value = "a";
  select.value = "b";

  // then
  expect(formEdited(chosen)).toBe(false);
});
