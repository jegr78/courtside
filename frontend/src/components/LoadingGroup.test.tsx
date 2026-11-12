import { act, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { LoadingGroup, LoadingStatus, LoadingTracker } from "./LoadingGroup";

const finish: Record<string, (state: "done" | "failed" | "loading") => void> = {};

function Part({ name }: { name: string }) {
  const [state, setState] = useState<"done" | "failed" | "loading">("loading");
  useEffect(() => {
    finish[name] = (next) => act(() => setState(next));
  }, [name]);
  if (state === "loading") return <LoadingStatus />;
  return <p data-testid={`part-${name}`}>{state}</p>;
}

function renderGroup(names: string[]) {
  render(<LoadingGroup testId="group">{names.map((name) => <Part key={name} name={name} />)}</LoadingGroup>);
  return screen.getByTestId("group-content");
}

describe("LoadingGroup", () => {
  it("given two parts, when only one has answered, then the content stays invisible behind one status", async () => {
    // given
    const content = renderGroup(["a", "b"]);

    // when
    finish.a("done");
    await act(() => Promise.resolve());

    // then
    expect(content.className, "the content keeps its layout but is not shown").toContain("invisible");
    expect(screen.getByTestId("group-loading"), "the group shows its own loading status").toBeTruthy();
  });

  it("given two parts, when both have answered, then the content shows and the group's status goes", async () => {
    // given
    const content = renderGroup(["a", "b"]);

    // when
    finish.a("done");
    finish.b("done");
    await act(() => Promise.resolve());

    // then
    expect(content.className, "the content shows once every part has answered").not.toContain("invisible");
    expect(screen.queryByTestId("group-loading"), "the group's status is gone").toBeNull();
  });

  it("given two parts, when the last one answers, then the group says once that it shows", async () => {
    // given
    const revealed = vi.fn();
    render(<LoadingGroup testId="group" revealed={revealed}>{["a", "b"].map((name) => <Part key={name} name={name} />)}</LoadingGroup>);

    // when
    finish.a("done");
    await act(() => Promise.resolve());

    // then
    expect(revealed, "nothing shows while a part still loads").not.toHaveBeenCalled();

    // when
    finish.b("done");
    await act(() => Promise.resolve());
    finish.a("loading");
    await act(() => Promise.resolve());

    // then
    expect(revealed).toHaveBeenCalledTimes(1);
  });

  it("given two parts, when one fails and the other answers, then the content shows with the failure in place", async () => {
    // given
    const content = renderGroup(["a", "b"]);

    // when
    finish.a("failed");
    finish.b("done");
    await act(() => Promise.resolve());

    // then
    expect(content.className, "a failure counts as an answer").not.toContain("invisible");
    expect(screen.getByTestId("part-a").textContent).toBe("failed");
  });

  it("given a shown group, when a part loads again, then the content stays visible", async () => {
    // given
    const content = renderGroup(["a"]);
    finish.a("done");
    await act(() => Promise.resolve());

    // when
    finish.a("loading");
    await act(() => Promise.resolve());

    // then
    expect(content.className, "a retry or a new period does not hide the page again").not.toContain("invisible");
  });

  it("given a part that hands over to another part in one render, when the first answers, then the group keeps waiting", async () => {
    // given
    function Chain() {
      const [first, setFirst] = useState(false);
      useEffect(() => {
        finish.first = () => act(() => setFirst(true));
      }, []);
      return first ? <Part name="second" /> : <LoadingStatus />;
    }
    render(<LoadingGroup testId="group"><Chain /></LoadingGroup>);

    // when
    finish.first("done");
    await act(() => Promise.resolve());

    // then
    expect(screen.getByTestId("group-content").className, "a read that only starts after another counts as pending").toContain("invisible");
  });

  it("when a loading status renders outside a group, then it is a plain status", () => {
    // when
    render(<LoadingStatus />);

    // then
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("given a tracker around a group, when the group's parts answer, then the tracker turns quiet only after the group shows", async () => {
    // given
    const quiet = vi.fn();
    render(<LoadingTracker quiet={quiet}><LoadingGroup testId="group"><Part name="a" /></LoadingGroup></LoadingTracker>);
    await act(() => Promise.resolve());
    expect(quiet, "a hidden group keeps the page busy").not.toHaveBeenCalledWith(true);

    // when
    finish.a("done");
    await act(() => Promise.resolve());
    await act(() => Promise.resolve());

    // then
    expect(quiet, "the page is quiet once the group shows").toHaveBeenLastCalledWith(true);
  });

  it("given a quiet tracker, when a part loads again, then the tracker is busy again", async () => {
    // given
    const quiet = vi.fn();
    render(<LoadingTracker quiet={quiet}><Part name="a" /></LoadingTracker>);
    finish.a("done");
    await act(() => Promise.resolve());

    // when
    finish.a("loading");
    await act(() => Promise.resolve());

    // then
    expect(quiet, "a new page load hides what waits for quiet again").toHaveBeenLastCalledWith(false);
  });

  it("given a part that never answers, when five seconds have passed, then the group shows what it has", async () => {
    // given
    vi.useFakeTimers();
    try {
      const content = renderGroup(["a", "b"]);
      finish.b("failed");
      await act(() => Promise.resolve());

      // when
      await act(() => vi.advanceTimersByTimeAsync(5_000));

      // then
      expect(content.className, "a hanging read does not hide the other parts for good").not.toContain("invisible");
    } finally {
      vi.useRealTimers();
    }
  });

  it("given a tracker whose part never answers, when five seconds have passed, then it reports quiet and stays so", async () => {
    // given
    vi.useFakeTimers();
    try {
      const quiet = vi.fn();
      render(<LoadingTracker quiet={quiet}><Part name="a" /><Part name="b" /></LoadingTracker>);
      await act(() => Promise.resolve());

      // when
      await act(() => vi.advanceTimersByTimeAsync(5_000));
      finish.b("done");
      await act(() => Promise.resolve());

      // then
      expect(quiet, "what waits for the page shows once patience is over").toHaveBeenLastCalledWith(true);
      expect(quiet).not.toHaveBeenLastCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
