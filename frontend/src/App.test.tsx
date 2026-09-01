import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { useMemo, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, AppRoutes } from "./App";
import { api, type SessionStatus } from "./api/client";
import { ClubConfigurationProvider } from "./club/ClubConfigurationProvider";
import { Preferences } from "./components/Preferences";
import i18n from "./i18n";

const anonymous: SessionStatus = {
  authenticated: false,
  roles: [],
  passwordChangeRequired: false
};

// The application runs on a data router, and the navigation guard inside it refuses anything else.
function RoutedShell({ initialEntries = ["/"], children }: { initialEntries?: string[]; children: ReactNode }) {
  const router = useMemo(
    () => createMemoryRouter([{ path: "*", element: children }], { initialEntries }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
  return <ClubConfigurationProvider><RouterProvider router={router} /></ClubConfigurationProvider>;
}


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
      <RoutedShell initialEntries={["/"]}>
        <AppRoutes session={anonymous} refreshSession={() => Promise.resolve()} clubName="Example Tennis Club" />
      </RoutedShell>
    );

    // then
    expect(await screen.findByTestId("court-plan-view")).toBeInTheDocument();
    expect(screen.getByTestId("sign-in-link")).toHaveAttribute("href", "/login");
    expect(screen.getByTestId("public-club-name")).toHaveTextContent("Example Tennis Club");
    expect(screen.getByTestId("guest-guidance")).toHaveTextContent("Belegungsplan");
  });

  it("given a member, when opening the landing page, then guest guidance stays out of the member workflow", async () => {
    // given
    vi.spyOn(api, "bookingGrid").mockResolvedValue({
      timeZone: "Europe/Berlin",
      slotMinutes: 30,
      openingHours: []
    });
    vi.spyOn(api, "courts").mockResolvedValue([]);

    // when
    render(
      <RoutedShell initialEntries={["/"]}>
        <AppRoutes session={{ ...anonymous, authenticated: true }} refreshSession={() => Promise.resolve()}
          clubName="Example Tennis Club" />
      </RoutedShell>
    );

    // then
    expect(await screen.findByTestId("court-plan-view")).toBeInTheDocument();
    expect(screen.queryByTestId("guest-guidance")).not.toBeInTheDocument();
  });

  it("given an anonymous visitor, when opening personal bookings, then sign in is required", () => {
    // when
    render(
      <RoutedShell initialEntries={["/my-bookings"]}>
        <AppRoutes session={anonymous} refreshSession={() => Promise.resolve()} />
      </RoutedShell>
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
      <RoutedShell initialEntries={["/courts"]}>
        <AppRoutes session={anonymous} refreshSession={() => Promise.resolve()} />
      </RoutedShell>
    );

    // then
    expect(await screen.findByTestId("court-plan-view")).toBeInTheDocument();
    expect(screen.getByTestId("court-plan-link")).toHaveAttribute("aria-current", "page");
  });

  it("given a member session, when opening sign in, then it anchors the app shell at the top", () => {
    render(
      <RoutedShell initialEntries={["/login"]}>
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
      </RoutedShell>
    );

    expect(screen.getByTestId("court-plan-view")).toHaveClass("self-start");
    expect(screen.getByTestId("court-plan-link")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("my-bookings-link")).toHaveAttribute("href", "/my-bookings");
  });

  it("given an initial password session, when opening the app, then it requires a new password", () => {
    render(
      <RoutedShell initialEntries={["/"]}>
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
      </RoutedShell>
    );

    expect(screen.getByTestId("initial-password-view")).toBeInTheDocument();
  });

  // The control sits in the account menu and the shell reacts to the session it leaves behind, so
  // the two are rendered together the way the application arranges them.
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
      return <>
        <Preferences authenticated={session.authenticated} signedOut={() => setSession(anonymous)} />
        <AppRoutes
          session={session}
          refreshSession={() => Promise.reject(new Error("must not be called"))}
        />
      </>;
    }
    render(<RoutedShell><Harness /></RoutedShell>);
    await userEvent.click(screen.getByTestId("preferences-menu"));

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
    render(<RoutedShell initialEntries={["/admin/configuration"]}><AppRoutes session={{
      authenticated: true,
      username: "admin",
      displayName: "Example Administrator",
      roles: ["ADMIN"],
      passwordChangeRequired: false
    }} refreshSession={() => Promise.resolve()} /></RoutedShell>);

    // then
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  // The two audiences do not share a layout: inside administration the surface carries its own
  // navigation, and the member bar would offer a second, competing way back to the court plan.
  it("given an admin session, when opening an administrative page, then the member bar gives way to it", () => {
    // given
    vi.spyOn(api, "adminConfig").mockReturnValue(new Promise<never>(() => undefined));
    vi.spyOn(api, "ruleSets").mockReturnValue(new Promise<never>(() => undefined));
    vi.spyOn(api, "ruleTypes").mockReturnValue(new Promise<never>(() => undefined));

    // when
    render(<RoutedShell initialEntries={["/admin/configuration"]}><AppRoutes session={{
      authenticated: true,
      username: "admin",
      displayName: "Example Administrator",
      roles: ["ADMIN"],
      passwordChangeRequired: false
    }} refreshSession={() => Promise.resolve()} /></RoutedShell>);

    // then
    expect(screen.queryByTestId("primary-navigation")).not.toBeInTheDocument();
    expect(screen.getByTestId("admin-navigation")).toBeInTheDocument();
    expect(screen.getByTestId("court-plan-link")).toHaveAttribute("href", "/");
  });

  // One guard on /admin stands for every destination below it, however deep — the facility routes
  // sit a level further down than the rest, and a guard that only reached its children would let
  // them through.
  it.each([
    ["/admin/configuration", "admin-configuration-view"],
    ["/admin/facility/opening-hours", "admin-opening-hours-view"]
  ])("given a member session, when opening %s, then it is not served", (address, view) => {
    // when
    render(<RoutedShell initialEntries={[address]}><AppRoutes session={{
      authenticated: true,
      username: "doe.jane",
      displayName: "Jane Doe",
      roles: ["MEMBER"],
      passwordChangeRequired: false
    }} refreshSession={() => Promise.resolve()} /></RoutedShell>);

    // then
    expect(screen.queryByTestId("admin-navigation")).not.toBeInTheDocument();
    expect(screen.queryByTestId(view)).not.toBeInTheDocument();
    expect(screen.getByTestId("court-plan-view")).toBeInTheDocument();
  });

  it("given an admin session, when opening the court plan, then the member bar carries administration", () => {
    // when
    render(<RoutedShell initialEntries={["/"]}><AppRoutes session={{
      authenticated: true,
      username: "admin",
      displayName: "Example Administrator",
      roles: ["ADMIN"],
      passwordChangeRequired: false
    }} refreshSession={() => Promise.resolve()} /></RoutedShell>);

    // then
    expect(screen.getByTestId("primary-navigation")).toBeInTheDocument();
    expect(screen.getByTestId("administration-link")).toHaveAttribute("href", "/admin/configuration");
  });

  // The four subjects of the facility are pages of their own, so a link can point at one of them.
  it.each([
    ["/admin/facility", "admin-courts-view"],
    ["/admin/facility/courts", "admin-courts-view"],
    ["/admin/facility/opening-hours", "admin-opening-hours-view"],
    ["/admin/facility/booking-cards", "admin-booking-cards-view"],
    ["/admin/facility/slot-fillers", "admin-slot-fillers-view"]
  ])("given an admin session, when opening %s, then %s is the page", (address, view) => {
    // given
    vi.spyOn(api, "adminCourts").mockReturnValue(new Promise<never>(() => undefined));
    vi.spyOn(api, "adminOpeningHours").mockReturnValue(new Promise<never>(() => undefined));
    vi.spyOn(api, "adminBookingCards").mockReturnValue(new Promise<never>(() => undefined));
    vi.spyOn(api, "adminParticipantCards").mockReturnValue(new Promise<never>(() => undefined));

    // when
    render(<RoutedShell initialEntries={[address]}><AppRoutes session={{
      authenticated: true,
      username: "admin",
      displayName: "Example Administrator",
      roles: ["ADMIN"],
      passwordChangeRequired: false
    }} refreshSession={() => Promise.resolve()} /></RoutedShell>);

    // then
    expect(screen.getByTestId(view)).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  // The club's configuration belongs to the shell, not to each page: walking the facility must not
  // make the instance answer the same question once per page.
  it("given an admin on the courts, when the opening hours are opened, then the club is not asked for a second time", async () => {
    // given
    const asked = vi.spyOn(api, "config").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30, timeZone: "Pacific/Auckland"
    });
    vi.spyOn(api, "adminCourts").mockResolvedValue([{ id: "court-1", number: 1, name: "Centre Court", active: true }]);
    vi.spyOn(api, "adminOpeningHours").mockResolvedValue([{ dayOfWeek: "MONDAY", opensAt: "08:00:00", closesAt: "22:00:00" }]);
    render(<RoutedShell initialEntries={["/admin/facility/courts"]}><AppRoutes session={{
      authenticated: true,
      username: "admin",
      displayName: "Example Administrator",
      roles: ["ADMIN"],
      passwordChangeRequired: false
    }} refreshSession={() => Promise.resolve()} /></RoutedShell>);
    await screen.findByTestId("court-row-court-1");

    // when
    await userEvent.click(screen.getByTestId("admin-opening-hours-link"));

    // then
    expect(await screen.findByTestId("hours-open-MONDAY")).toBeInTheDocument();
    expect(asked).toHaveBeenCalledTimes(1);
  });
});

describe("App build identity", () => {
  const club = {
    clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
    defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30, timeZone: "Europe/Berlin"
  };
  const adminClub = {
    ...club, newAccountCredentialHours: 168, passwordResetCredentialHours: 24,
    bookingReminderHours: 24, logoUploaded: false
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given an account that reads another language, when it signs in, then the navigation never appears in the language it is about to leave", async () => {
    // given — the shell starts in the club's default language and the account reads English
    await i18n.changeLanguage("de");
    let applyLanguage: () => void = () => undefined;
    vi.spyOn(i18n, "changeLanguage")
      .mockImplementation(() => new Promise((resolve) => { applyLanguage = () => resolve(i18n.t); }) as never);
    vi.spyOn(api, "session").mockResolvedValue({
      authenticated: true, roles: ["MEMBER"], passwordChangeRequired: false, locale: "en", displayName: "Jane Doe"
    });
    vi.spyOn(api, "config").mockRejectedValue(new Error("unavailable"));
    vi.spyOn(api, "source").mockRejectedValue(new Error("unavailable"));

    // when
    render(<RoutedShell><App /></RoutedShell>);
    await screen.findByTestId("environment-warning");

    // then — publishing the session first paints the signed-in navigation twice, and the second
    // painting moves every link out from under whoever was already reaching for one
    expect(screen.queryByTestId("logout")).not.toBeInTheDocument();
    applyLanguage();
    expect(await screen.findByTestId("logout")).toBeInTheDocument();
  });

  it("given a language that cannot be applied, when an account signs in, then it is signed in anyway", async () => {
    // given
    await i18n.changeLanguage("de");
    vi.spyOn(i18n, "changeLanguage").mockRejectedValue(new Error("no bundle"));
    vi.spyOn(api, "session").mockResolvedValue({
      authenticated: true, roles: ["MEMBER"], passwordChangeRequired: false, locale: "en", displayName: "Jane Doe"
    });
    vi.spyOn(api, "config").mockRejectedValue(new Error("unavailable"));
    vi.spyOn(api, "source").mockRejectedValue(new Error("unavailable"));

    // when
    render(<RoutedShell><App /></RoutedShell>);

    // then — a language is a preference, and no preference may cost somebody their session
    expect(await screen.findByTestId("logout")).toBeInTheDocument();
  });

  it("given the source endpoint fails, when the app loads, then an identity warning remains visible", async () => {
    // given
    vi.spyOn(api, "session").mockResolvedValue(anonymous);
    vi.spyOn(api, "config").mockRejectedValue(new Error("unavailable"));
    vi.spyOn(api, "source").mockRejectedValue(new Error("unavailable"));

    // when
    render(<RoutedShell><App /></RoutedShell>);

    // then
    expect(await screen.findByTestId("environment-warning")).toHaveAttribute("role", "alert");
  });

  it("given the source endpoint hangs, when the app becomes usable, then its identity stays marked as unknown", async () => {
    // given
    vi.spyOn(api, "session").mockResolvedValue(anonymous);
    vi.spyOn(api, "config").mockRejectedValue(new Error("unavailable"));
    vi.spyOn(api, "source").mockReturnValue(new Promise<never>(() => undefined));

    // when
    render(<RoutedShell><App /></RoutedShell>);
    await screen.findByTestId("court-plan-view");

    // then
    expect(screen.getByTestId("environment-warning")).toHaveAttribute("role", "alert");
  });

  it("given short route, when shell renders, then the shell anchors content to the top", async () => {
    // given
    vi.spyOn(api, "session").mockResolvedValue(anonymous);
    vi.spyOn(api, "config").mockRejectedValue(new Error("unavailable"));
    vi.spyOn(api, "source").mockRejectedValue(new Error("unavailable"));

    // when
    render(<RoutedShell initialEntries={["/login"]}><App /></RoutedShell>);
    await screen.findByTestId("login-view");

    // then
    expect(screen.getByRole("main")).toHaveClass("items-start");
    expect(screen.getByRole("main")).not.toHaveClass("items-center");
  });

  it("given no club logo, when the shell loads, then the Courtside mark is the neutral fallback", async () => {
    // given
    vi.spyOn(api, "session").mockResolvedValue(anonymous);
    vi.spyOn(api, "config").mockResolvedValue({
      clubName: "Example Tennis Club",
      primaryColor: "#b85c38",
      accentColor: "#d7e24b",
      defaultLocale: "de",
      supportedLocales: ["de", "en"],
      slotMinutes: 30,
      timeZone: "Europe/Berlin"
    });
    vi.spyOn(api, "source").mockRejectedValue(new Error("unavailable"));

    // when
    render(<RoutedShell><App /></RoutedShell>);

    // then
    expect(await screen.findByTestId("courtside-mark")).toBeInTheDocument();
    expect(screen.getByTestId("club-brand-name")).toHaveTextContent("Example Tennis Club");
  });

  it("given a club logo, when the shell loads, then the club owns the header", async () => {
    // given
    vi.spyOn(api, "session").mockResolvedValue(anonymous);
    vi.spyOn(api, "config").mockResolvedValue({
      clubName: "Example Tennis Club",
      primaryColor: "#d7e24b",
      accentColor: "#b85c38",
      logoUrl: "/example-logo.svg",
      defaultLocale: "en",
      supportedLocales: ["de", "en"],
      slotMinutes: 30,
      timeZone: "Europe/Berlin"
    });
    vi.spyOn(api, "source").mockRejectedValue(new Error("unavailable"));

    // when
    render(<RoutedShell><App /></RoutedShell>);

    // then
    expect(await screen.findByTestId("club-logo")).toHaveAttribute("src", "/example-logo.svg");
    expect(document.documentElement.style.getPropertyValue("--club-primary-text")).toBe("#17211d");
  });

  it("given a club brand, when the shell loads, then the footer still names the product", async () => {
    // given
    vi.spyOn(api, "session").mockResolvedValue(anonymous);
    vi.spyOn(api, "config").mockResolvedValue({
      clubName: "Example Tennis Club",
      primaryColor: "#d7e24b",
      accentColor: "#b85c38",
      logoUrl: "/example-logo.svg",
      defaultLocale: "en",
      supportedLocales: ["de", "en"],
      slotMinutes: 30,
      timeZone: "Europe/Berlin"
    });
    vi.spyOn(api, "source").mockRejectedValue(new Error("unavailable"));

    // when
    render(<RoutedShell><App /></RoutedShell>);

    // then
    const productIdentity = await screen.findByTestId("footer-product-identity");
    expect(productIdentity).toHaveTextContent("Courtside");
    expect(within(productIdentity).getByTestId("footer-product-mark")).toBeInTheDocument();
  });

  it("given both legal links, when the shell loads, then the privacy policy sits beside the imprint", async () => {
    // given
    vi.spyOn(api, "session").mockResolvedValue(anonymous);
    vi.spyOn(api, "config").mockResolvedValue({
      clubName: "Example Tennis Club",
      primaryColor: "#b85c38",
      accentColor: "#d7e24b",
      imprintUrl: "/imprint",
      privacyUrl: "https://example-tennis-club.example/privacy",
      defaultLocale: "en",
      supportedLocales: ["de", "en"],
      slotMinutes: 30,
      timeZone: "Europe/Berlin"
    });
    vi.spyOn(api, "source").mockRejectedValue(new Error("unavailable"));

    // when
    render(<RoutedShell><App /></RoutedShell>);

    // then
    expect(await screen.findByTestId("footer-privacy"))
      .toHaveAttribute("href", "https://example-tennis-club.example/privacy");
    expect(screen.getByTestId("footer-imprint")).toHaveAttribute("href", "/imprint");
  });

  it("given no privacy policy link, when the shell loads, then the footer offers no empty target", async () => {
    // given
    vi.spyOn(api, "session").mockResolvedValue(anonymous);
    vi.spyOn(api, "config").mockResolvedValue({
      clubName: "Example Tennis Club",
      primaryColor: "#b85c38",
      accentColor: "#d7e24b",
      imprintUrl: "/imprint",
      defaultLocale: "en",
      supportedLocales: ["de", "en"],
      slotMinutes: 30,
      timeZone: "Europe/Berlin"
    });
    vi.spyOn(api, "source").mockRejectedValue(new Error("unavailable"));

    // when
    render(<RoutedShell><App /></RoutedShell>);

    // then
    expect(await screen.findByTestId("footer-imprint")).toBeInTheDocument();
    expect(screen.queryByTestId("footer-privacy")).not.toBeInTheDocument();
  });

  // Nothing else holds this wire: cutting the callback in App leaves every other test green, and
  // only the browser journey would notice.
  it("given a saved club name, when the configuration page reports it, then the shell carries it without a reload", async () => {
    // given
    vi.spyOn(api, "session").mockResolvedValue({
      authenticated: true, username: "admin", displayName: "Example Administrator",
      roles: ["ADMIN"], passwordChangeRequired: false
    });
    vi.spyOn(api, "source").mockRejectedValue(new Error("unavailable"));
    vi.spyOn(api, "config").mockResolvedValue(club);
    vi.spyOn(api, "adminConfig").mockResolvedValue(adminClub);
    vi.spyOn(api, "ruleSets").mockResolvedValue([{ id: "rule-set", name: "Standard", active: true }]);
    vi.spyOn(api, "ruleTypes").mockResolvedValue([]);
    vi.spyOn(api, "rules").mockResolvedValue([]);
    vi.spyOn(api, "membershipTypes").mockResolvedValue([]);
    vi.spyOn(api, "changeAdminConfig").mockResolvedValue({ ...adminClub, clubName: "Example Racquet Club" });
    render(<RoutedShell initialEntries={["/admin/configuration"]}><App /></RoutedShell>);
    await waitFor(() => expect(screen.getByTestId("club-brand-name")).toHaveTextContent("Example Tennis Club"));

    // when
    fireEvent.change(await screen.findByTestId("club-name"), { target: { value: "Example Racquet Club" } });
    fireEvent.click(screen.getByTestId("save-club-config"));

    // then
    expect(await screen.findByTestId("admin-save-success")).toBeInTheDocument();
    expect(screen.getByTestId("club-brand-name")).toHaveTextContent("Example Racquet Club");
  });

  it("given a mid luminance club colour, when the shell loads, then the higher contrast text colour is used", async () => {
    // given
    vi.spyOn(api, "session").mockResolvedValue(anonymous);
    vi.spyOn(api, "config").mockResolvedValue({
      clubName: "Example Tennis Club",
      primaryColor: "#009688",
      accentColor: "#d7e24b",
      defaultLocale: "de",
      supportedLocales: ["de", "en"],
      slotMinutes: 30,
      timeZone: "Europe/Berlin"
    });
    vi.spyOn(api, "source").mockRejectedValue(new Error("unavailable"));

    // when
    render(<RoutedShell><App /></RoutedShell>);

    // then
    await waitFor(() => expect(screen.getByTestId("club-brand-name")).toHaveTextContent("Example Tennis Club"));
    expect(document.documentElement.style.getPropertyValue("--club-primary-text")).toBe("#17211d");
  });
});
