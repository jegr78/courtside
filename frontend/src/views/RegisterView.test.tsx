import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api/client";
import i18n from "../i18n";
import { RegisterView } from "./RegisterView";
import { RegistrationVerificationView } from "./RegistrationVerificationView";

vi.mock("../club/registry", () => ({
  useClubConfiguration: () => ({ club: { registrationTextDe: "Willkommen, Gäste zahlen bar.", registrationTextEn: "Welcome, guests pay cash." } })
}));

describe("RegisterView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given the club's registration text, when the page opens in English, then the English text is shown", () => {
    // when
    render(<MemoryRouter><RegisterView /></MemoryRouter>);

    // then
    expect(screen.getByTestId("registration-text")).toHaveTextContent("Welcome, guests pay cash.");
  });

  it("given a completed form, when it is sent, then the registration names the person and the page asks to check the mail", async () => {
    // given
    const register = vi.spyOn(api, "register").mockResolvedValue(undefined);
    render(<MemoryRouter><RegisterView /></MemoryRouter>);

    // when
    await userEvent.type(screen.getByTestId("registration-first-name"), "John");
    await userEvent.type(screen.getByTestId("registration-last-name"), "Roe");
    await userEvent.type(screen.getByTestId("registration-email"), "john.roe@example.org");
    await userEvent.type(screen.getByTestId("registration-username"), "roe.john");
    await userEvent.type(screen.getByTestId("registration-password"), "Carefully chosen court phrase 47");
    await userEvent.click(screen.getByTestId("registration-submit"));

    // then
    expect(register).toHaveBeenCalledWith({ firstName: "John", lastName: "Roe", username: "roe.john",
      password: "Carefully chosen court phrase 47", email: "john.roe@example.org", language: "en" });
    expect(await screen.findByTestId("registration-sent")).toBeInTheDocument();
    expect(screen.queryByTestId("registration-submit")).toBeNull();
  });
});

describe("RegistrationVerificationView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given a link with its code, when the page opens, then the code is verified once and the account is announced active", async () => {
    // given
    const verify = vi.spyOn(api, "verifyRegistration").mockResolvedValue(undefined);

    // when
    render(<MemoryRouter initialEntries={["/registration/verify#ABCD-EFGH"]}><RegistrationVerificationView /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("registration-verified")).toBeInTheDocument();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith("ABCD-EFGH");
  });

  it("given a used code, when the page opens, then the refusal is shown and nothing claims success", async () => {
    // given
    vi.spyOn(api, "verifyRegistration").mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:registration-code-invalid", title: "Registration code invalid", status: 400
    }));

    // when
    render(<MemoryRouter initialEntries={["/registration/verify#ABCD-EFGH"]}><RegistrationVerificationView /></MemoryRouter>);

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("This link is unknown or was already used.");
    expect(screen.queryByTestId("registration-verified")).toBeNull();
  });
});

describe("LoginView registration link", () => {
  it("given the club admits external bookings, when the sign-in page opens, then it offers registration, and not otherwise", async () => {
    // given
    await i18n.changeLanguage("en");
    const { LoginView } = await import("./LoginView");

    // when
    const { unmount } = render(<MemoryRouter><LoginView refreshSession={() => Promise.resolve()} registration /></MemoryRouter>);
    const offered = screen.getByTestId("registration-link");
    unmount();
    render(<MemoryRouter><LoginView refreshSession={() => Promise.resolve()} /></MemoryRouter>);

    // then
    expect(offered).toHaveAttribute("href", "/register");
    expect(screen.queryByTestId("registration-link")).toBeNull();
  });
});
