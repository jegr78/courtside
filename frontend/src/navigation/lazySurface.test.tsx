import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { lazySurface } from "./lazySurface";

const reload = vi.fn();
const realLocation = window.location;

describe("lazySurface", () => {
  beforeEach(async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: Object.assign(new URL(realLocation.href), { reload })
    });
    reload.mockReset();
    await i18n.changeLanguage("de");
  });

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  });

  it("given a surface that arrives, when it is rendered, then it replaces the waiting state", async () => {
    // given
    const Surface = lazySurface(() => Promise.resolve({
      default: ({ name }: { name: string }) => <p data-testid="loaded-surface">{name}</p>
    }));

    // when
    render(<Suspense fallback={<p role="status" />}><Surface name="Example Tennis Club" /></Suspense>);

    // then
    expect(await screen.findByTestId("loaded-surface")).toHaveTextContent("Example Tennis Club");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("given a surface whose chunk a newer deployment replaced, when it is rendered, then a reload is offered", async () => {
    // given
    const Surface = lazySurface<object>(
      () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
    render(<Suspense fallback={<p role="status" />}><Surface /></Suspense>);

    // when
    await userEvent.click(await screen.findByTestId("retry-load"));

    // then
    expect(screen.getByTestId("load-failure"))
      .toHaveTextContent("Dieser Bereich lässt sich gerade nicht laden. Lade die Seite neu.");
    expect(reload, "a rejected chunk import is remembered, so only a new document fetches it again")
      .toHaveBeenCalledOnce();
  });
});
