import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { PwaLifecycle } from "./PwaLifecycle";

const { registerSW } = vi.hoisted(() => ({ registerSW: vi.fn() }));

vi.mock("virtual:pwa-register", () => ({ registerSW }));

describe("PwaLifecycle", () => {
  beforeEach(() => registerSW.mockReset());

  it("given a waiting service worker, when the user accepts the update, then the new version is activated", async () => {
    // given
    const update = vi.fn().mockResolvedValue(undefined);
    let needRefresh: (() => void) | undefined;
    registerSW.mockImplementation((options?: { onNeedRefresh: () => void }) => {
      needRefresh = options?.onNeedRefresh;
      return update;
    });
    render(<PwaLifecycle />);

    // when
    needRefresh?.();
    await userEvent.click(await screen.findByTestId("pwa-update"));

    // then
    expect(update).toHaveBeenCalledWith(true);
  });

  it("given no waiting update, when the component loads, then no update prompt is shown", () => {
    // given
    registerSW.mockReturnValue(vi.fn());

    // when
    render(<PwaLifecycle />);

    // then
    expect(screen.queryByTestId("pwa-update")).not.toBeInTheDocument();
  });
});
