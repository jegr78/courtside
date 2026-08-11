import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, AppRoutes } from "./App";
import { api, type SessionStatus } from "./api/client";
import i18n from "./i18n";

const anonymous: SessionStatus = {
  authenticated: false,
  roles: [],
  passwordChangeRequired: false
};

describe("AppRoutes", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("de");
  });

  it("given an anonymous visitor, when opening the landing page, then the public court plan and sign-in action are shown", async () => {
    // given
    vi.spyOn(api, "bookingGrid").mockResolvedValue({
      timeZone: "Europe/Berlin",
      slotMinutes: 30,
      openingHours: []
    });
    vi.spyOn(api, "courts").mockResolvedValue([]);

    // when
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes session={anonymous} refreshSession={() => Promise.resolve()} />
      </MemoryRouter>
    );

    // then
    expect(await screen.findByTestId("court-plan-view")).toBeInTheDocument();
    expect(screen.getByTestId("sign-in-link")).toHaveAttribute("href", "/login");
  });

  it("given an anonymous visitor, when opening personal bookings, then sign in is required", () => {
    // when
    render(
      <MemoryRouter initialEntries={["/my-bookings"]}>
        <AppRoutes session={anonymous} refreshSession={() => Promise.resolve()} />
      </MemoryRouter>
    );

    // then
    expect(screen.getByTestId("login-view")).toBeInTheDocument();
  });

  it("given an anonymous visitor, when opening the court alias, then the public plan remains directly addressable", async () => {
    // given
    vi.spyOn(api, "bookingGrid").mockResolvedValue({
      timeZone: "Europe/Berlin",
      slotMinutes: 30,
      openingHours: []
    });
    vi.spyOn(api, "courts").mockResolvedValue([]);

    // when
    render(
      <MemoryRouter initialEntries={["/courts"]}>
        <AppRoutes session={anonymous} refreshSession={() => Promise.resolve()} />
      </MemoryRouter>
    );

    // then
    expect(await screen.findByTestId("court-plan-view")).toBeInTheDocument();
    expect(screen.getByTestId("court-plan-link")).toHaveAttribute("aria-current", "page");
  });

  it("given a member session, when opening sign in, then it anchors the app shell at the top", () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <AppRoutes
          session={{
            authenticated: true,
            username: "doe.jane",
            displayName: "Jane Doe",
            roles: ["MEMBER"],
            passwordChangeRequired: false
          }}
          refreshSession={() => Promise.resolve()}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId("court-plan-view")).toHaveClass("self-start");
    expect(screen.getByTestId("court-plan-link")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("my-bookings-link")).toHaveAttribute("href", "/my-bookings");
  });

  it("given an initial password session, when opening the app, then it requires a new password", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes
          session={{
            authenticated: true,
            username: "admin",
            displayName: "Ada Admin",
            roles: ["ADMIN"],
            passwordChangeRequired: true
          }}
          refreshSession={() => Promise.resolve()}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId("initial-password-view")).toBeInTheDocument();
  });

  it("given a member session, when sign out succeeds, then the public plan offers sign in without another session request", async () => {
    // given
    vi.spyOn(api, "logout").mockResolvedValue();
    const member: SessionStatus = {
      authenticated: true,
      username: "doe.jane",
      displayName: "Jane Doe",
      roles: ["MEMBER"],
      passwordChangeRequired: false
    };
    function Harness() {
      const [session, setSession] = useState(member);
      return <AppRoutes
        session={session}
        refreshSession={() => Promise.reject(new Error("must not be called"))}
        signedOut={() => setSession(anonymous)}
      />;
    }
    render(<MemoryRouter><Harness /></MemoryRouter>);

    // when
    await userEvent.click(screen.getByTestId("logout"));

    // then
    expect(await screen.findByTestId("sign-in-link")).toHaveAttribute("href", "/login");
  });

  it("given an admin session, when opening configuration, then the protected admin view is available", () => {
    // given
    vi.spyOn(api, "adminConfig").mockReturnValue(new Promise<never>(() => undefined));
    vi.spyOn(api, "ruleSets").mockReturnValue(new Promise<never>(() => undefined));
    vi.spyOn(api, "ruleTypes").mockReturnValue(new Promise<never>(() => undefined));

    // when
    render(<MemoryRouter initialEntries={["/admin/configuration"]}><AppRoutes session={{
      authenticated: true,
      username: "admin",
      displayName: "Example Administrator",
      roles: ["ADMIN"],
      passwordChangeRequired: false
    }} refreshSession={() => Promise.resolve()} /></MemoryRouter>);

    // then
    expect(screen.getByText("Courtside wird geladen …")).toBeInTheDocument();
  });

  it("given an admin session, when opening facility management, then the protected admin view is available", () => {
    // given
    vi.spyOn(api, "adminCourts").mockReturnValue(new Promise<never>(() => undefined));
    vi.spyOn(api, "adminOpeningHours").mockReturnValue(new Promise<never>(() => undefined));
    vi.spyOn(api, "adminBookingCards").mockReturnValue(new Promise<never>(() => undefined));

    // when
    render(<MemoryRouter initialEntries={["/admin/facility"]}><AppRoutes session={{
      authenticated: true,
      username: "admin",
      displayName: "Example Administrator",
      roles: ["ADMIN"],
      passwordChangeRequired: false
    }} refreshSession={() => Promise.resolve()} /></MemoryRouter>);

    // then
    expect(screen.getByText("Courtside wird geladen …")).toBeInTheDocument();
  });
});

describe("App build identity", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given the source endpoint fails, when the app loads, then an identity warning remains visible", async () => {
    // given
    vi.spyOn(api, "session").mockResolvedValue(anonymous);
    vi.spyOn(api, "config").mockRejectedValue(new Error("unavailable"));
    vi.spyOn(api, "source").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter><App /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("environment-warning")).toHaveAttribute("role", "alert");
  });

  it("given the source endpoint hangs, when the app becomes usable, then its identity stays marked as unknown", async () => {
    // given
    vi.spyOn(api, "session").mockResolvedValue(anonymous);
    vi.spyOn(api, "config").mockRejectedValue(new Error("unavailable"));
    vi.spyOn(api, "source").mockReturnValue(new Promise<never>(() => undefined));

    // when
    render(<MemoryRouter><App /></MemoryRouter>);
    await screen.findByTestId("court-plan-view");

    // then
    expect(screen.getByTestId("environment-warning")).toHaveAttribute("role", "alert");
  });

  it("givenNoClubLogo_whenTheShellLoads_thenTheCourtsideMarkIsTheNeutralFallback", async () => {
    // given
    vi.spyOn(api, "session").mockResolvedValue(anonymous);
    vi.spyOn(api, "config").mockResolvedValue({
      clubName: "Example Tennis Club",
      primaryColor: "#b85c38",
      accentColor: "#d7e24b",
      defaultLocale: "de"
    });
    vi.spyOn(api, "source").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter><App /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("courtside-mark")).toBeInTheDocument();
    expect(screen.getByText("Example Tennis Club")).toBeInTheDocument();
  });

  it("givenAClubLogo_whenTheShellLoads_thenTheClubOwnsTheHeader", async () => {
    // given
    vi.spyOn(api, "session").mockResolvedValue(anonymous);
    vi.spyOn(api, "config").mockResolvedValue({
      clubName: "Example Tennis Club",
      primaryColor: "#d7e24b",
      accentColor: "#b85c38",
      logoUrl: "/example-logo.svg",
      defaultLocale: "en"
    });
    vi.spyOn(api, "source").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter><App /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("club-logo")).toHaveAttribute("src", "/example-logo.svg");
    expect(document.documentElement.style.getPropertyValue("--club-primary-text")).toBe("#17211d");
  });

  it("givenAMidLuminanceClubColour_whenTheShellLoads_thenTheHigherContrastTextColourIsUsed", async () => {
    // given
    vi.spyOn(api, "session").mockResolvedValue(anonymous);
    vi.spyOn(api, "config").mockResolvedValue({
      clubName: "Example Tennis Club",
      primaryColor: "#009688",
      accentColor: "#d7e24b",
      defaultLocale: "de"
    });
    vi.spyOn(api, "source").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter><App /></MemoryRouter>);

    // then
    await screen.findByTestId("courtside-mark");
    expect(document.documentElement.style.getPropertyValue("--club-primary-text")).toBe("#17211d");
  });
});
