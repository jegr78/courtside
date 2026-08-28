import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SuccessFeedback } from "./SuccessFeedback";

it("given a focused control, when success feedback appears, then it is announced without taking focus", () => {
  // given
  const { rerender } = render(<button type="button">Save</button>);
  screen.getByRole("button").focus();

  // when
  rerender(<><button type="button">Save</button><SuccessFeedback>Saved.</SuccessFeedback></>);

  // then
  expect(screen.getByRole("button")).toHaveFocus();
  expect(screen.getByRole("status")).toHaveTextContent("Saved.");
});
