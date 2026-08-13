import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceOffer } from "../api/client";
import i18n from "../i18n";
import { BuildIdentity, EnvironmentMarker } from "./BuildIdentity";

const source: SourceOffer = {
  version: "1.4.0",
  commit: "9f1c0e3a5b7d2f4681c9a0e5d3b7f2a4c6e8d0b1",
  environment: "PRODUCTION",
  sourceUrl: "https://example.org/git/courtside"
};

describe("BuildIdentity", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("given build metadata, when rendered, then the exact build is always visible", () => {
    // given / when
    render(<BuildIdentity source={source} />);

    // then
    expect(screen.getByTestId("build-identity")).toHaveTextContent("v1.4.0 · 9f1c0e3");
  });

  it("given a UAT build, when rendered, then the environment is persistently identified", () => {
    // given / when
    render(<EnvironmentMarker source={{ ...source, environment: "UAT" }} />);

    // then
    expect(screen.getByTestId("environment-marker")).toHaveTextContent("UAT");
  });

  it("given a performance build, when rendered, then the disposable environment is identified", () => {
    // given / when
    render(<EnvironmentMarker source={{ ...source, environment: "PERFORMANCE" }} />);

    // then
    expect(screen.getByTestId("environment-marker")).toHaveTextContent("Performance test environment");
  });

  it("given unavailable metadata, when rendered, then the missing identity is conspicuous", () => {
    // given / when
    render(<EnvironmentMarker identityStatus="unavailable" />);

    // then
    expect(screen.getByTestId("environment-warning")).toHaveAttribute("role", "alert");
  });

  it("given build metadata, when opening details, then complete diagnostics can be copied", async () => {
    // given
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<BuildIdentity source={source} />);

    // when
    await userEvent.click(screen.getByTestId("build-identity"));
    await userEvent.click(screen.getByTestId("copy-build-identity"));

    // then
    expect(screen.getByRole("dialog")).toHaveTextContent(source.commit ?? "");
    expect(writeText).toHaveBeenCalledWith([
      "Courtside 1.4.0",
      `Commit: ${source.commit}`,
      "Environment: PRODUCTION",
      `Source: ${source.sourceUrl}`
    ].join("\n"));

    // when
    const close = screen.getByTestId("close-build-identity");
    expect(close).toHaveRole("button");
    expect(close).toHaveAccessibleName("Close");
    await userEvent.click(close);

    // then
    expect(screen.getByTestId("build-identity")).toHaveFocus();
  });

  it("given unavailable metadata, when rendered, then a localized fallback remains visible", () => {
    // given / when
    render(<BuildIdentity />);

    // then
    expect(screen.getByTestId("build-identity")).toHaveTextContent("Version unavailable");
  });
});
