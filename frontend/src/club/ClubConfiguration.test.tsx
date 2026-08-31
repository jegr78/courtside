import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ClubConfig } from "../api/client";
import i18n from "../i18n";
import { ClubConfigurationProvider } from "./ClubConfigurationProvider";
import { useClubConfiguration } from "./registry";

const club: ClubConfig = {
  clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
  defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30, timeZone: "Pacific/Auckland"
};

function Zone({ testId }: { testId: string }) {
  const { club: held, error } = useClubConfiguration();
  return <p data-testid={testId}>{error ?? held?.timeZone ?? "waiting"}</p>;
}

function Saver() {
  const { changed } = useClubConfiguration();
  return <button data-testid="report-change" type="button" onClick={() => changed({ ...club, timeZone: "Europe/Berlin" })}>save</button>;
}

function show(children: ReactNode) {
  return render(<ClubConfigurationProvider>{children}</ClubConfigurationProvider>);
}

describe("ClubConfiguration", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given two views that need the club, when both are shown, then the configuration is asked for once", async () => {
    // given
    const asked = vi.spyOn(api, "config").mockResolvedValue(club);

    // when
    show(<><Zone testId="first" /><Zone testId="second" /></>);

    // then
    expect(await screen.findByTestId("first")).toHaveTextContent("Pacific/Auckland");
    expect(screen.getByTestId("second")).toHaveTextContent("Pacific/Auckland");
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("given a saved configuration, when the page that saved it reports the change, then every view reads it without asking again", async () => {
    // given
    const asked = vi.spyOn(api, "config").mockResolvedValue(club);
    show(<><Zone testId="first" /><Saver /></>);
    expect(await screen.findByTestId("first")).toHaveTextContent("Pacific/Auckland");

    // when
    await userEvent.click(screen.getByTestId("report-change"));

    // then
    expect(screen.getByTestId("first")).toHaveTextContent("Europe/Berlin");
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("given a club nobody can read, when a view needs it, then the failure is reported rather than a substitute time zone", async () => {
    // given
    vi.spyOn(api, "config").mockRejectedValue(new Error("unreachable"));

    // when
    show(<Zone testId="first" />);

    // then
    expect(await screen.findByTestId("first")).toHaveTextContent(i18n.t("error.generic"));
  });

  it("given a reported failure, when the reader changes language, then the message follows them", async () => {
    // given
    vi.spyOn(api, "config").mockRejectedValue(new Error("unreachable"));
    show(<Zone testId="first" />);
    expect(await screen.findByTestId("first")).toHaveTextContent("That did not work. Please try again.");

    // when
    await act(() => i18n.changeLanguage("de"));

    // then
    expect(screen.getByTestId("first")).toHaveTextContent("Das hat nicht funktioniert. Bitte versuche es erneut.");
  });

  it("given a load that failed, when the next view is shown, then the club is asked for again", async () => {
    // given
    const asked = vi.spyOn(api, "config").mockRejectedValue(new Error("unreachable"));
    const { rerender } = show(<Zone testId="first" />);
    expect(await screen.findByTestId("first")).toHaveTextContent(i18n.t("error.generic"));
    asked.mockResolvedValue(club);

    // when
    rerender(<ClubConfigurationProvider><Zone testId="first" /><Zone testId="second" /></ClubConfigurationProvider>);

    // then
    await waitFor(() => expect(screen.getByTestId("second")).toHaveTextContent("Pacific/Auckland"));
    expect(asked).toHaveBeenCalledTimes(2);
  });
});
