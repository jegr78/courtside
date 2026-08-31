import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AdminShell } from "./AdminShell";

function show(at: string) {
  render(<MemoryRouter initialEntries={[at]}>
    <Routes>
      <Route path="/admin" element={<AdminShell />}>
        <Route path="facility" element={<p data-testid="a-page">facility</p>} />
      </Route>
    </Routes>
  </MemoryRouter>);
}

describe("AdminShell", () => {
  it("given an administrative page, when it is shown, then the navigation sits beside it", () => {
    // when
    show("/admin/facility");

    // then
    expect(screen.getByTestId("admin-menu")).toBeInTheDocument();
    expect(screen.getByTestId("a-page")).toBeInTheDocument();
  });

  // The width belongs to the frame, so a page cannot forget to carry it and none can disagree.
  it("when an administrative page is shown, then the frame carries the one width", () => {
    // when
    show("/admin/facility");

    // then
    expect(screen.getByTestId("admin-shell")).toHaveClass("max-w-7xl");
  });
});
