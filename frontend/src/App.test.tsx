import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "./App";
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

  it("given an anonymous visitor, when opening a protected route, then it shows sign in", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes session={anonymous} refreshSession={() => Promise.resolve()} />
      </MemoryRouter>
    );

    expect(screen.getByTestId("login-view")).toBeInTheDocument();
  });

  it("given a member session, when opening sign in, then it shows the app shell", () => {
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

    expect(screen.getByTestId("home-view")).toBeInTheDocument();
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

  it("given a member session, when sign out succeeds, then sign in is shown without another request", async () => {
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
    expect(await screen.findByTestId("login-view")).toBeInTheDocument();
  });
});
