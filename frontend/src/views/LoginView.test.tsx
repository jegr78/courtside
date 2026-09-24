import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError, api } from "../api/client";
import i18n from "../i18n";
import { LoginView } from "./LoginView";

describe("LoginView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given refused credentials, when signing in, then the member reads that the username or password is wrong", async () => {
    // given
    vi.spyOn(api, "login").mockRejectedValue(new ApiError(401, {
      type: "urn:courtside:error:unauthenticated", title: "Not authenticated", status: 401
    }));
    render(<MemoryRouter><LoginView refreshSession={() => Promise.resolve()} /></MemoryRouter>);

    // when
    await userEvent.type(screen.getByTestId("username"), "doe.jane");
    await userEvent.type(screen.getByTestId("password"), "wrong-password");
    await userEvent.click(screen.getByTestId("login-submit"));

    // then
    expect(await screen.findByRole("alert"), "a refused sign-in names the credentials, not an ended session")
      .toHaveTextContent("The username or password is incorrect.");
  });
});
