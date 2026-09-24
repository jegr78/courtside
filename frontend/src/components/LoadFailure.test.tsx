import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import "../i18n";
import { LoadFailure } from "./LoadFailure";

it("given a failed load, when it is shown, then the member reads why and is offered the request again", async () => {
  // given
  const retry = vi.fn();
  render(<LoadFailure message="The server ran into an error." retry={retry} />);

  // when
  await userEvent.click(screen.getByTestId("retry-load"));

  // then
  expect(screen.getByRole("alert")).toHaveTextContent("The server ran into an error.");
  expect(retry, "the control repeats the request").toHaveBeenCalledTimes(1);
});
