import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect } from "react";
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

it("given plain content, when the dialog opens, then the dialog is a panel of its own with a scrolling body", () => {
  // when
  render(<Modal labelledBy="heading" closed={vi.fn()}>
    <h2 id="heading">Booking</h2>
    <button type="button">Book now</button>
  </Modal>);

  // then
  const dialog = screen.getByRole("dialog");
  expect(dialog, "the dialog draws its own surface instead of the dimmed page").toHaveClass("surface-panel");
  expect(dialog.querySelector("[data-testid='dialog-body']"), "plain content scrolls inside the panel").toContainElement(screen.getByRole("button"));
});

it("given content composed of its own sections, when the dialog opens, then the panel holds it without a second body", () => {
  // when
  render(<Modal labelledBy="heading" closed={vi.fn()} composed testId="booking">
    <h2 id="heading">Booking</h2>
  </Modal>);

  // then
  const dialog = screen.getByRole("dialog");
  expect(dialog, "the panel carries the caller's test ID").toBe(screen.getByTestId("booking"));
  expect(dialog, "a composed dialog still draws its own surface").toHaveClass("surface-panel");
  expect(dialog.querySelector("[data-testid='dialog-body']"), "a composed dialog brings its own body").toBeNull();
});

it("given a dialog opened from inside another, when Escape is pressed, then only the inner one closes", async () => {
  // given
  const outerClosed = vi.fn();
  const innerClosed = vi.fn();
  render(<Modal labelledBy="outer" closed={outerClosed}>
    <h2 id="outer">Form</h2>
    <Modal labelledBy="inner" closed={innerClosed}>
      <h2 id="inner">Confirm</h2>
      <input data-testid="inner-field" />
    </Modal>
  </Modal>);
  screen.getByTestId("inner-field").focus();

  // when
  await userEvent.keyboard("{Escape}");

  // then
  expect(innerClosed, "the inner dialog closes").toHaveBeenCalledTimes(1);
  expect(outerClosed, "the outer dialog stays open").not.toHaveBeenCalled();
});

it("given a dialog open, when a second one opens, then both lie on the body in opening order", () => {
  // given / when
  render(<>
    <Modal labelledBy="first" closed={vi.fn()} testId="first"><h2 id="first">First</h2></Modal>
    <Modal labelledBy="second" closed={vi.fn()} testId="second"><h2 id="second">Second</h2></Modal>
  </>);

  // then
  const overlays = Array.from(document.body.children).filter((child) => child.getAttribute("data-testid") === "modal-overlay");
  expect(overlays.map((overlay) => overlay.querySelector("[role=dialog]")?.getAttribute("data-testid")),
    "each dialog lies directly on the body in opening order").toEqual(["first", "second"]);
});

it("given a dialog opening, when the first frame is drawn, then its first control already holds the focus", () => {
  // given
  let focusedAtLayout: Element | null = null;
  function Probe() {
    useLayoutEffect(() => { focusedAtLayout = document.activeElement; });
    return null;
  }

  // when
  render(<>{disclosureDialog()}<Probe /></>);

  // then
  expect(focusedAtLayout, "a field typed into right after opening keeps what was typed").toBe(screen.getByTestId("before"));
});
