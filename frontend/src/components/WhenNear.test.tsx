import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeIntersectionObserver as FakeObserver } from "../test/intersection";
import { WhenNear } from "./WhenNear";

describe("WhenNear", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeObserver.latest = undefined;
  });

  it("given content below the window, when it has not come near, then it is not mounted", () => {
    // given
    vi.stubGlobal("IntersectionObserver", FakeObserver);

    // when
    render(<WhenNear testId="later"><p data-testid="content">content</p></WhenNear>);
    act(() => FakeObserver.latest!.intersect(false));

    // then
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
    expect(screen.getByTestId("later-pending")).toBeInTheDocument();
    expect(FakeObserver.latest!.options?.rootMargin, "it starts loading a screen before it is seen").toBe("100% 0px");
  });

  it("given content below the window, when it comes near, then it is mounted and stays", () => {
    // given
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    render(<WhenNear testId="later"><p data-testid="content">content</p></WhenNear>);

    // when
    act(() => FakeObserver.latest!.intersect(true));

    // then
    expect(screen.getByTestId("content")).toBeInTheDocument();
    expect(screen.queryByTestId("later-pending")).not.toBeInTheDocument();
    expect(FakeObserver.latest!.observed, "nothing is watched once it is mounted").toEqual([]);
  });

  it("given a browser without an intersection observer, when the content renders, then it is mounted at once", () => {
    // given
    vi.stubGlobal("IntersectionObserver", undefined);

    // when
    render(<WhenNear testId="later"><p data-testid="content">content</p></WhenNear>);

    // then
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });
});
