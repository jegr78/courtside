import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type SessionStatus } from "../api/client";
import i18n from "../i18n";
import { WithClubConfiguration } from "../test/ClubConfiguration";
import { AccountView } from "./AccountView";

const profile: SessionStatus = { authenticated: true, username: "doe.jane", firstName: "Jane Mary", lastName: "Doe Roe",
  displayName: "A display name that must not be split", roles: ["TRAINER", "TREASURER"], passwordChangeRequired: false };
const actions = { passwordChanged: () => undefined, signedOut: () => undefined };

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(api, "accountSessions").mockImplementation(() => new Promise(() => {}));
  await i18n.changeLanguage("en");
});

it.each([
  ["de", "Mein Konto", "Profil", ["Trainer", "Kassenwart"]],
  ["en", "My account", "Profile", ["Trainer", "Treasurer"]]
])("given a signed-in account, when its profile opens in %s, then separate names and every assigned role are shown", async (locale, title, heading, roles) => {
  // given
  await i18n.changeLanguage(locale);

  // when
  render(<WithClubConfiguration><AccountView session={profile} {...actions} /></WithClubConfiguration>);

  // then
  expect(screen.getByTestId("account-title")).toHaveTextContent(title);
  const section = screen.getByTestId("account-profile");
  expect(within(section).getByRole("heading")).toHaveTextContent(heading);
  expect(within(section).getByTestId("profile-username")).toHaveTextContent("doe.jane");
  expect(within(section).getByTestId("profile-first-name")).toHaveTextContent("Jane Mary");
  expect(within(section).getByTestId("profile-last-name")).toHaveTextContent("Doe Roe");
  expect(within(section).getAllByTestId("profile-role").map((role) => role.textContent)).toEqual(roles);
  expect(section.compareDocumentPosition(screen.getByTestId("account-security-view")) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
});

it("given an account has no roles, when its profile opens, then an explicit empty assignment state replaces invented membership", () => {
  // given
  const session = { ...profile, roles: [] };

  // when
  render(<WithClubConfiguration><AccountView session={session} {...actions} /></WithClubConfiguration>);

  // then
  expect(screen.getByTestId("profile-no-roles")).toHaveTextContent("No roles assigned");
  expect(screen.queryByTestId("profile-role")).not.toBeInTheDocument();
});

it("given offline booking access synthesizes a member session, when the account opens, then its identity and role assignment stay unavailable", () => {
  // given
  const session: SessionStatus = { authenticated: true, roles: ["MEMBER"], passwordChangeRequired: false };

  // when
  render(<WithClubConfiguration><AccountView session={session} offline {...actions} /></WithClubConfiguration>);

  // then
  expect(screen.getByTestId("profile-unavailable")).toHaveTextContent("Account details are currently unavailable");
  expect(screen.queryByTestId("profile-role")).not.toBeInTheDocument();
  expect(screen.queryByTestId("profile-username")).not.toBeInTheDocument();
});

it("given a session lacks separate name fields, when its profile opens, then displayName is never split to invent them", () => {
  // given
  const session = { ...profile, firstName: undefined, lastName: undefined };

  // when
  render(<WithClubConfiguration><AccountView session={session} {...actions} /></WithClubConfiguration>);

  // then
  expect(screen.getByTestId("profile-first-name")).toHaveTextContent("Unavailable");
  expect(screen.getByTestId("profile-last-name")).toHaveTextContent("Unavailable");
  expect(screen.getByTestId("account-profile")).not.toHaveTextContent(profile.displayName!);
});

it.each([false, true])("given stale names without verified authority %s, when the profile renders, then no previous identity is exposed", (authenticated) => {
  // given
  const session = { ...profile, authenticated, username: authenticated ? undefined : profile.username };

  // when
  render(<WithClubConfiguration><AccountView session={session} {...actions} /></WithClubConfiguration>);

  // then
  expect(screen.queryByTestId("profile-unavailable")).toBeInTheDocument();
  expect(screen.queryByTestId("profile-username")).not.toBeInTheDocument();
  expect(screen.queryByTestId("profile-role")).not.toBeInTheDocument();
  expect(screen.getByTestId("account-profile")).not.toHaveTextContent("Jane Mary");
});

it("given another account takes over, when the session changes, then the old profile and pending security state are replaced", () => {
  // given
  const sessions = vi.spyOn(api, "accountSessions");
  const view = render(<WithClubConfiguration><AccountView session={profile} {...actions} /></WithClubConfiguration>);

  // when
  view.rerender(<WithClubConfiguration><AccountView session={{ ...profile, username: "roe.john", firstName: "John", lastName: "Roe", roles: ["MEMBER"] }} {...actions} /></WithClubConfiguration>);

  // then
  expect(screen.getByTestId("account-profile")).not.toHaveTextContent("doe.jane");
  expect(screen.getByTestId("profile-first-name")).toHaveTextContent("John");
  expect(screen.getAllByTestId("profile-role").map((role) => role.textContent)).toEqual(["Member"]);
  expect(sessions).toHaveBeenCalledTimes(2);
});

it("given an account name contains markup, when its profile renders, then the name remains inert text", () => {
  // given
  const firstName = '<img src=x onerror="window.profileExecuted=true">';

  // when
  render(<WithClubConfiguration><AccountView session={{ ...profile, firstName }} {...actions} /></WithClubConfiguration>);

  // then
  expect(screen.getByTestId("profile-first-name")).toHaveTextContent(firstName);
  expect(screen.getByTestId("profile-first-name").querySelector("img")).toBeNull();
});

const browserSession = { handle: "A234567890123456789012", createdAt: "2026-09-07T10:00:00Z",
  lastActivityAt: "2026-09-07T11:00:00Z", current: true, browserFamily: "FIREFOX" as const };

it("given the previous account has a pending session action, when another account arrives before completion, then the old action cannot sign out the new identity", async () => {
  // given
  vi.spyOn(api, "accountSessions").mockResolvedValue([browserSession]);
  let complete!: () => void;
  vi.spyOn(api, "endAccountSession").mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  const signedOut = vi.fn();
  const view = render(<WithClubConfiguration><AccountView session={profile} {...actions} signedOut={signedOut} /></WithClubConfiguration>);
  await userEvent.click(await screen.findByTestId("end-current-session"));

  // when
  view.rerender(<WithClubConfiguration><AccountView session={{ ...profile, username: "roe.john" }} {...actions} signedOut={signedOut} /></WithClubConfiguration>);
  await act(() => Promise.resolve().then(complete));

  // then
  expect(signedOut, "the old account's completion belongs to its unmounted security view").not.toHaveBeenCalled();
  expect(screen.getByTestId("profile-username")).toHaveTextContent("roe.john");
});

it("given password proof belongs to the previous account, when that proof returns after an account switch, then no action runs with the new session", async () => {
  // given
  vi.spyOn(api, "accountSessions").mockResolvedValue([browserSession]);
  const endAll = vi.spyOn(api, "endOwnSessions").mockResolvedValue(undefined).mockRejectedValueOnce(new ApiError(403, {
    type: "urn:courtside:error:recent-authentication-required", title: "Proof required", status: 403
  }));
  let proved!: () => void;
  vi.spyOn(api, "reauthenticate").mockReturnValue(new Promise((resolve) => { proved = resolve; }));
  const signedOut = vi.fn();
  const view = render(<WithClubConfiguration><AccountView session={profile} {...actions} signedOut={signedOut} /></WithClubConfiguration>);
  await userEvent.click(screen.getByTestId("end-all-sessions"));
  await userEvent.type(document.getElementById("reauthentication-password")!, "old-account-password");
  await userEvent.click(screen.getByTestId("reauthentication-submit"));

  // when
  view.rerender(<WithClubConfiguration><AccountView session={{ ...profile, username: "roe.john" }} {...actions} signedOut={signedOut} /></WithClubConfiguration>);
  await act(() => Promise.resolve().then(proved));

  // then
  await waitFor(() => expect(api.reauthenticate).toHaveBeenCalledOnce());
  expect(endAll, "a proof response cannot start an action for a different account").toHaveBeenCalledOnce();
  expect(signedOut).not.toHaveBeenCalled();
});

it("given password proof is still pending, when the holder cancels the dialog, then its late answer cannot run the cancelled action", async () => {
  // given
  const endAll = vi.spyOn(api, "endOwnSessions").mockResolvedValue(undefined).mockRejectedValueOnce(new ApiError(403, {
    type: "urn:courtside:error:recent-authentication-required", title: "Proof required", status: 403
  }));
  let proved!: () => void;
  vi.spyOn(api, "reauthenticate").mockReturnValue(new Promise((resolve) => { proved = resolve; }));
  const signedOut = vi.fn();
  render(<WithClubConfiguration><AccountView session={profile} {...actions} signedOut={signedOut} /></WithClubConfiguration>);
  await userEvent.click(screen.getByTestId("end-all-sessions"));
  await userEvent.type(document.getElementById("reauthentication-password")!, "old-account-password");
  await userEvent.click(screen.getByTestId("reauthentication-submit"));

  // when
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(() => Promise.resolve().then(proved));

  // then
  expect(endAll, "a cancelled proof cannot start its former action").toHaveBeenCalledOnce();
  expect(signedOut).not.toHaveBeenCalled();
  expect(screen.getByTestId("end-all-sessions")).toBeEnabled();
});

it("given a session action was already submitted, when the proof dialog closes before its response, then its confirmed result still signs out that same account", async () => {
  // given
  let complete!: () => void;
  const endAll = vi.spyOn(api, "endOwnSessions").mockRejectedValueOnce(new ApiError(403, {
    type: "urn:courtside:error:recent-authentication-required", title: "Proof required", status: 403
  })).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
  vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
  const signedOut = vi.fn();
  render(<WithClubConfiguration><AccountView session={profile} {...actions} signedOut={signedOut} /></WithClubConfiguration>);
  await userEvent.click(screen.getByTestId("end-all-sessions"));
  await userEvent.type(document.getElementById("reauthentication-password")!, "current-password");
  await userEvent.click(screen.getByTestId("reauthentication-submit"));
  expect(endAll).toHaveBeenCalledTimes(2);

  // when
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(() => Promise.resolve().then(complete));

  // then
  expect(signedOut, "dismissing proof cannot undo a server action already sent for this account").toHaveBeenCalledOnce();
});

it("given a proved session action is pending, when another account arrives before its response, then the old confirmed result cannot sign out the new account", async () => {
  // given
  let complete!: () => void;
  vi.spyOn(api, "endOwnSessions").mockRejectedValueOnce(new ApiError(403, {
    type: "urn:courtside:error:recent-authentication-required", title: "Proof required", status: 403
  })).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
  vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
  const signedOut = vi.fn();
  const view = render(<WithClubConfiguration><AccountView session={profile} {...actions} signedOut={signedOut} /></WithClubConfiguration>);
  await userEvent.click(screen.getByTestId("end-all-sessions"));
  await userEvent.type(document.getElementById("reauthentication-password")!, "current-password");
  await userEvent.click(screen.getByTestId("reauthentication-submit"));
  expect(api.endOwnSessions).toHaveBeenCalledTimes(2);

  // when
  view.rerender(<WithClubConfiguration><AccountView session={{ ...profile, username: "roe.john" }} {...actions} signedOut={signedOut} /></WithClubConfiguration>);
  await act(() => Promise.resolve().then(complete));

  // then
  expect(signedOut, "an action already sent for the former account cannot clear the new identity").not.toHaveBeenCalled();
});
