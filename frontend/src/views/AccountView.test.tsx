import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api, type SessionStatus } from "../api/client";
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
