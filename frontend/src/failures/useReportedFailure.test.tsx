import { act, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { problemReference } from "../api/problem-message";
import i18n from "../i18n";
import { useReportedFailure } from "./useReportedFailure";

const traced = new ApiError(500, {
  type: "urn:courtside:error:unexpected", title: "Unexpected", status: 500, traceId: "trace-1"
});

function Zone() {
  const { message, report, refuse, clear } = useReportedFailure();
  const [loads, setLoads] = useState(0);

  useEffect(() => {
    setLoads((current) => current + 1);
  }, [report]);

  return <>
    <p data-testid="loads">{loads}</p>
    <p data-testid="message">{message ?? "—"}</p>
    <button data-testid="report" type="button" onClick={() => report(new Error("unreachable"))}>report</button>
    <button data-testid="refuse" type="button" onClick={() => refuse("a form refused its own body")}>refuse</button>
    <button data-testid="clear" type="button" onClick={() => clear()}>clear</button>
    <button data-testid="refer" type="button" onClick={() => report(traced, problemReference)}>refer</button>
  </>;
}

describe("useReportedFailure", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("given an effect depending on reporting, when the language changes, then the effect does not run again", async () => {
    // given
    render(<Zone />);
    expect(screen.getByTestId("loads")).toHaveTextContent("1");

    // when
    await act(() => i18n.changeLanguage("de"));

    // then
    expect(screen.getByTestId("loads")).toHaveTextContent("1");
  });

  it("given a reported failure on screen, when the language changes, then it is read out in the new language", async () => {
    // given
    render(<Zone />);
    act(() => screen.getByTestId("report").click());
    expect(screen.getByTestId("message")).toHaveTextContent("That did not work. Please try again.");

    // when
    await act(() => i18n.changeLanguage("de"));

    // then
    expect(screen.getByTestId("message")).toHaveTextContent("Das hat nicht funktioniert. Bitte versuche es erneut.");
  });

  it("given a refusal the surface worded itself, when the language changes, then it is left as it was given", async () => {
    // given
    render(<Zone />);
    act(() => screen.getByTestId("refuse").click());

    // when
    await act(() => i18n.changeLanguage("de"));

    // then — the caller resolved this text against the language it had, and there is no key to redo
    expect(screen.getByTestId("message")).toHaveTextContent("a form refused its own body");
  });

  it("given a failure reported through another describer, when the language changes, then that describer is asked again", async () => {
    // given
    render(<Zone />);
    act(() => screen.getByTestId("refer").click());
    expect(screen.getByTestId("message")).toHaveTextContent("Error reference: trace-1");

    // when
    await act(() => i18n.changeLanguage("de"));

    // then
    expect(screen.getByTestId("message")).toHaveTextContent("Fehlerreferenz: trace-1");
  });

  it("given something was reported, when it is cleared, then nothing is left to read", () => {
    // given
    render(<Zone />);
    act(() => screen.getByTestId("report").click());

    // when
    act(() => screen.getByTestId("clear").click());

    // then
    expect(screen.getByTestId("message")).toHaveTextContent("—");
  });
});
