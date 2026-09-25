import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LocaleSelect } from "./LocaleSelect";

it("given an option the page never offered, when it is chosen, then no language change is requested", () => {
  // given
  const changed = vi.fn();
  render(<LocaleSelect testId="locale" value="de" changed={changed} />);
  const select = screen.getByTestId("locale");
  const injected = document.createElement("option");
  injected.value = "xx";
  select.append(injected);

  // when
  fireEvent.change(select, { target: { value: "xx" } });

  // then
  expect(changed, "a value outside the shipped languages names no bundle").not.toHaveBeenCalled();
});

it("given a shipped language, when it is chosen, then that language is requested", () => {
  // given
  const changed = vi.fn();
  render(<LocaleSelect testId="locale" value="de" changed={changed} />);

  // when
  fireEvent.change(screen.getByTestId("locale"), { target: { value: "en" } });

  // then
  expect(changed).toHaveBeenCalledWith("en");
});
