import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Modal } from "./Modal";

function disclosureDialog() {
  return <Modal labelledBy="heading" closed={vi.fn()}>
    <h2 id="heading">Booking</h2>
    <input data-testid="before" />
    <details>
      <summary data-testid="summary">More details</summary>
      <input data-testid="hidden-inside" />
    </details>
    <button data-testid="after" type="button">Book now</button>
  </Modal>;
}

it("given a collapsed disclosure, when tabbing through the dialog, then focus passes it and reaches the last control", async () => {
  // given — a trap that counts controls the browser refuses to focus lands on nothing and every
  // further Tab repeats that, which is a keyboard deadlock rather than a trap
  render(disclosureDialog());
  screen.getByTestId("before").focus();

  // when
  await userEvent.tab();
  await userEvent.tab();

  // then
  expect(screen.getByTestId("after")).toHaveFocus();
});

it("given a collapsed disclosure, when tabbing, then its summary is a stop of its own", async () => {
  // given
  render(disclosureDialog());
  screen.getByTestId("before").focus();

  // when
  await userEvent.tab();

  // then
  expect(screen.getByTestId("summary")).toHaveFocus();
});

it("given an open disclosure, when tabbing, then the control inside it is reached", async () => {
  // given
  render(<Modal labelledBy="heading" closed={vi.fn()}>
    <h2 id="heading">Booking</h2>
    <input data-testid="before" />
    <details open>
      <summary data-testid="summary">More details</summary>
      <input data-testid="inside" />
    </details>
  </Modal>);
  screen.getByTestId("before").focus();

  // when
  await userEvent.tab();
  await userEvent.tab();

  // then
  expect(screen.getByTestId("inside")).toHaveFocus();
});

it("given a disclosure closed inside another, when tabbing, then the inner summary is passed too", async () => {
  // given — closest() only sees the nearest closed disclosure, so an inner summary looked
  // reachable although no browser focuses anything inside a collapsed outer one
  render(<Modal labelledBy="heading" closed={vi.fn()}>
    <h2 id="heading">Booking</h2>
    <input data-testid="before" />
    <details>
      <summary data-testid="outer-summary">More details</summary>
      <details>
        <summary data-testid="inner-summary">Even more</summary>
        <input data-testid="deep" />
      </details>
    </details>
    <button data-testid="after" type="button">Book now</button>
  </Modal>);
  screen.getByTestId("before").focus();

  // when
  await userEvent.tab();
  await userEvent.tab();

  // then
  expect(screen.getByTestId("after")).toHaveFocus();
});

it("given a control that refuses the focus, when tabbing, then the trap moves on instead of repeating", async () => {
  // given — a target that swallows focus() would otherwise leave activeElement where it was, and
  // the next Tab would compute the same jump for ever
  render(<Modal labelledBy="heading" closed={vi.fn()}>
    <h2 id="heading">Booking</h2>
    <input data-testid="before" />
    <input data-testid="refuses" />
    <button data-testid="after" type="button">Book now</button>
  </Modal>);
  const refusing = screen.getByTestId("refuses");
  refusing.focus = () => undefined;
  screen.getByTestId("before").focus();

  // when
  await userEvent.tab();

  // then
  expect(screen.getByTestId("after")).toHaveFocus();
});

it("given the focus on a panel between two controls, when tabbing either way, then it moves to the neighbouring control", async () => {
  // given
  render(<Modal labelledBy="heading" closed={vi.fn()}>
    <h2 id="heading">Move</h2>
    <button data-testid="before" type="button">Preview</button>
    <div data-testid="panel" tabIndex={-1}>Blocked</div>
    <button data-testid="after" type="button">Close</button>
  </Modal>);
  screen.getByTestId("panel").focus();

  // when
  await userEvent.tab();

  // then
  expect(screen.getByTestId("after"), "Tab continues after the panel rather than at the first control").toHaveFocus();

  // when
  screen.getByTestId("panel").focus();
  await userEvent.tab({ shift: true });

  // then
  expect(screen.getByTestId("before"), "Shift+Tab continues before the panel rather than at the last control").toHaveFocus();
});
