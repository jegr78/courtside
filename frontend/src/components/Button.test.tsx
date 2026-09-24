import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it.each([
    ["primary", "button-primary"],
    ["secondary", "button-secondary"],
    ["destructive", "button-destructive"],
    ["destructive-confirm", "button-destructive-confirm"],
  ] as const)("given the %s variant, when rendered, then it uses the matching action level", (variant, className) => {
    // given / when
    render(<Button variant={variant}>Action</Button>);

    // then
    expect(screen.getByRole("button")).toHaveClass(className);
  });
});
