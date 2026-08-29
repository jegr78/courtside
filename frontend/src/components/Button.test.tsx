import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it.each([
    ["primary", "button-primary"],
    ["secondary", "button-secondary"],
    ["destructive", "button-destructive"],
  ] as const)("givenThe%sVariant_whenRendered_thenItUsesTheMatchingActionLevel", (variant, className) => {
    // given / when
    render(<Button variant={variant}>Action</Button>);

    // then
    expect(screen.getByRole("button")).toHaveClass(className);
  });
});
