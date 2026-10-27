import { act, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { App, AppRoutes } from "./App";
import { api, type SessionStatus } from "./api/client";
import i18n from "./i18n";
import { WithClubConfiguration } from "./test/ClubConfiguration";

const account: SessionStatus = { authenticated: true, username: "doe.jane", firstName: "Jane Mary", lastName: "Doe Roe",
  roles: ["TRAINER", "TREASURER"], passwordChangeRequired: false };
const anonymous: SessionStatus = { authenticated: false, roles: [], passwordChangeRequired: false };
let scrollIntoView = vi.fn();

function Address() {
  const location = useLocation();
  return <output data-testid="account-address">{location.pathname + location.search}</output>;
}

function routes(session: SessionStatus, path: string) {
  const router = createMemoryRouter([{ path: "*", element: <WithClubConfiguration>
    <AppRoutes session={session} refreshSession={() => Promise.resolve()} /><Address />
  </WithClubConfiguration> }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
  vi.spyOn(api, "accountSessions").mockImplementation(() => new Promise(() => {}));
  scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
});

it.each(["/account", "/account/security"])("given an anonymous visitor, when opening %s, then sign-in preserves the exact account destination", async (path) => {
  // when
  routes(anonymous, path);

  // then
  expect(await screen.findByTestId("login-view")).toBeInTheDocument();
  expect(screen.getByTestId("account-address")).toHaveTextContent(`/login?returnTo=${encodeURIComponent(path)}`);
  expect(screen.queryByTestId("account-profile")).not.toBeInTheDocument();
});

it.each(["/account", "/account/security"])("given an initial password session, when opening %s, then the password transition remains mandatory", async (path) => {
  // given
  const initial = { ...account, passwordChangeRequired: true };

  // when
  routes(initial, path);

  // then
  expect(await screen.findByTestId("initial-password-view")).toBeInTheDocument();
  expect(screen.getByTestId("account-address")).toHaveTextContent(`/initial-password?returnTo=${encodeURIComponent(path)}`);
  expect(screen.queryByTestId("account-profile")).not.toBeInTheDocument();
});

it("given an account without membership, when it opens the account and security shortcut, then the requested section receives focus", async () => {
  // given
  const router = routes(account, "/account");

  // when / then
  expect(screen.getByTestId("profile-username")).toHaveTextContent("doe.jane");
  expect(screen.getByTestId("account-title")).toHaveFocus();
  screen.getByTestId("current-password").focus();
  await act(() => router.navigate("/account"));
  expect(screen.getByTestId("account-title")).toHaveFocus();
  await act(() => router.navigate("/account/security"));
  expect(screen.getByTestId("account-security-title")).toHaveFocus();
  expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "start" });
  await act(() => router.navigate("/account"));
  expect(screen.getByTestId("account-title")).toHaveFocus();
});

it("given the live app replaces or loses account identity, when its session changes, then the global control and profile expose only the current identity", async () => {
  // given
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const session = vi.spyOn(api, "session").mockResolvedValue(account);
  vi.spyOn(api, "source").mockRejectedValue(new Error("source unavailable"));
  const router = createMemoryRouter([{ path: "*", element: <WithClubConfiguration><App /></WithClubConfiguration> }],
    { initialEntries: ["/account"] });
  render(<RouterProvider router={router} />);
  expect(await screen.findByTestId("profile-username")).toHaveTextContent("doe.jane");
  expect(screen.getByTestId("account-identity")).toHaveTextContent("doe.jane");

  // when
  await act(() => window.dispatchEvent(new Event("offline")));

  // then
  expect(screen.getByTestId("profile-unavailable")).toBeVisible();
  expect(screen.getByTestId("account-identity")).not.toHaveTextContent("doe.jane");
  expect(screen.queryByTestId("profile-role")).not.toBeInTheDocument();

  // when
  session.mockResolvedValue({ ...account, username: "roe.john", firstName: "John", lastName: "Roe", roles: [] });
  await act(() => window.dispatchEvent(new Event("online")));

  // then
  await waitFor(() => expect(screen.getByTestId("account-identity")).toHaveTextContent("roe.john"));
  expect(screen.getByTestId("profile-first-name")).toHaveTextContent("John");
  expect(screen.getByTestId("profile-no-roles")).toBeVisible();
  expect(screen.getByTestId("account-view")).not.toHaveTextContent("doe.jane");

  // when
  await act(() => window.dispatchEvent(new Event("courtside:unauthenticated")));

  // then
  expect(await screen.findByTestId("login-view")).toBeInTheDocument();
  expect(screen.queryByTestId("account-identity")).not.toBeInTheDocument();
  expect(screen.queryByTestId("account-profile")).not.toBeInTheDocument();
});
