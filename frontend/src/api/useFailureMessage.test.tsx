import { act, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import { useFailureMessage } from "./useFailureMessage";

function Zone() {
  const failureMessage = useFailureMessage();
  const [loads, setLoads] = useState(0);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    setLoads((current) => current + 1);
  }, [failureMessage]);

  return <>
    <p data-testid="loads">{loads}</p>
    <p data-testid="message">{message}</p>
    <button data-testid="fail" type="button" onClick={() => setMessage(failureMessage(new Error("unreachable")))}>
      fail
    </button>
  </>;
}

describe("useFailureMessage", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("given an effect depending on it, when the language changes, then the effect does not run again", async () => {
    // given
    render(<Zone />);
    expect(screen.getByTestId("loads")).toHaveTextContent("1");

    // when
    await act(() => i18n.changeLanguage("de"));

    // then
    expect(screen.getByTestId("loads")).toHaveTextContent("1");
  });

  it("given the language has changed, when a failure is described, then it reads in the new language", async () => {
    // given
    render(<Zone />);
    await act(() => i18n.changeLanguage("de"));

    // when
    act(() => screen.getByTestId("fail").click());

    // then
    expect(screen.getByTestId("message")).toHaveTextContent("Das hat nicht funktioniert. Bitte versuche es erneut.");
  });
});
