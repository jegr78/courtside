import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import "../i18n";
import { ColorInput } from "./ColorInput";

it("given a hex value typed into the field, when it changes, then the colour is reported and the picker follows it", () => {
  // given
  const changed = vi.fn();
  const { rerender } = render(<ColorInput id="card" valueTestId="card-value" pickerTestId="card-picker" value="#b85c38" changed={changed} />);

  // when
  fireEvent.change(screen.getByTestId("card-value"), { target: { value: "#17211d" } });
  rerender(<ColorInput id="card" valueTestId="card-value" pickerTestId="card-picker" value="#17211d" changed={changed} />);

  // then
  expect(changed).toHaveBeenCalledWith("#17211d");
  expect(screen.getByTestId("card-picker")).toHaveValue("#17211d");
});

it("given a colour chosen in the picker, when it changes, then the field shows its hex value", () => {
  // given
  const changed = vi.fn();
  render(<ColorInput id="card" valueTestId="card-value" pickerTestId="card-picker" value="#b85c38" changed={changed} />);

  // when
  fireEvent.input(screen.getByTestId("card-picker"), { target: { value: "#176b55" } });

  // then
  expect(changed).toHaveBeenCalledWith("#176b55");
});

it("given an incomplete hex value, when it is shown, then the field keeps it and the picker does not pretend to hold it", () => {
  // when
  render(<ColorInput id="card" valueTestId="card-value" pickerTestId="card-picker" value="#17" changed={() => undefined} />);

  // then
  expect(screen.getByTestId("card-value")).toHaveValue("#17");
  expect(screen.getByTestId("card-picker"), "the picker holds only complete colours").toHaveValue("#000000");
});
