import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Alert } from "./Alert";

describe("Alert", () => {
  it.each([
    ["error", "alert", "--cs-notice-error"],
    ["warning", "status", "--cs-notice-warning"],
    ["info", "status", "--cs-notice-info"],
    ["success", "status", "--cs-notice-success"]
  ] as const)("given the %s tone, when it is shown, then it takes its own role and tokens", (tone, role, token) => {
    // when
    render(<Alert tone={tone} testId="notice">Notice</Alert>);

    // then
    const notice = screen.getByTestId("notice");
    expect(notice, `${tone} announces itself as ${role}`).toHaveAttribute("role", role);
    expect(notice.className, `${tone} draws its colours from ${token}`).toContain(`bg-(${token}-surface)`);
    expect(notice.className).toContain(`border-(${token}-border)`);
    expect(notice.className).toContain(`text-(${token}-text)`);
  });

  it("given no tone, when it is shown, then it is announced as an error", () => {
    // when
    render(<Alert testId="notice">Failed</Alert>);

    // then
    expect(screen.getByTestId("notice")).toHaveAttribute("role", "alert");
  });
});
