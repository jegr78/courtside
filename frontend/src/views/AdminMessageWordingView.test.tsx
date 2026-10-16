import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError, api, type MessageTemplate } from "../api/client";
import i18n from "../i18n";
import { AdminMessageWordingView } from "./AdminMessageWordingView";

const shippedDe = { subject: "{clubName}: dein Benutzername", body: "Hallo {firstName}, {username}." };
const shippedEn = { subject: "{clubName}: your username", body: "Hello {firstName}, {username}." };
const own = { subject: "{clubName}: login", body: "Hi {firstName}, it is {username}." };

function reminder(englishOwn: typeof own | null = null): MessageTemplate {
  return {
    kind: "ACCOUNT_USERNAME_REMINDER",
    placeholders: ["clubName", "firstName", "instanceLink", "username"],
    requiredPlaceholders: ["username"],
    languages: [
      { language: "de", shipped: shippedDe, own: null },
      { language: "en", shipped: shippedEn, own: englishOwn }
    ]
  };
}

function show() {
  render(<MemoryRouter><AdminMessageWordingView /></MemoryRouter>);
}

async function chooseEnglish() {
  await userEvent.selectOptions(await screen.findByTestId("wording-language"), "en");
}

describe("AdminMessageWordingView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "messageTemplates").mockResolvedValue([reminder()]);
  });

  it("given a message with a required placeholder, when the page loads, then the shipped wording and the placeholders are shown", async () => {
    // when
    show();

    // then
    expect(await screen.findByTestId("wording-subject")).toHaveValue(shippedDe.subject);
    expect(screen.getByTestId("wording-body")).toHaveValue(shippedDe.body);
    expect(screen.getByTestId("wording-state")).toHaveAttribute("data-own", "false");
    const placeholders = within(screen.getByTestId("wording-placeholders")).getAllByRole("listitem");
    expect(placeholders.filter((item) => item.dataset.required === "true")).toHaveLength(1);
    expect(placeholders.find((item) => item.dataset.required === "true")).toHaveTextContent("{username}");
    expect(screen.getByTestId("wording-reset")).toBeDisabled();
  });

  it("given an edited wording, when previewed, then the filled text is shown and nothing is stored", async () => {
    // given
    const previewing = vi.spyOn(api, "previewMessageTemplate").mockResolvedValue({ subject: "Example: login", body: "Hi Jane, it is jane.doe." });
    const changing = vi.spyOn(api, "changeMessageTemplate");
    show();
    await chooseEnglish();
    fireEvent.change(screen.getByTestId("wording-body"), { target: { value: own.body } });

    // when
    await userEvent.click(screen.getByTestId("wording-preview"));

    // then
    expect(await screen.findByTestId("wording-preview-body")).toHaveTextContent("Hi Jane, it is jane.doe.");
    expect(previewing).toHaveBeenCalledWith("ACCOUNT_USERNAME_REMINDER", "en", { subject: shippedEn.subject, body: own.body });
    expect(changing).not.toHaveBeenCalled();
  });

  it("given a wording without the username, when saved, then every refusal is shown translated", async () => {
    // given
    vi.spyOn(api, "changeMessageTemplate").mockRejectedValue(new ApiError(422, {
      type: "urn:courtside:error:message-template-refused", title: "Message template refused", status: 422,
      violations: [
        { code: "messageTemplate.placeholder.unknown", params: { placeholder: "nickname" } },
        { code: "messageTemplate.placeholder.missing", params: { placeholder: "username" } }
      ]
    }));
    show();
    await screen.findByTestId("wording-body");

    // when
    await userEvent.click(screen.getByTestId("wording-save"));

    // then
    const refusals = within(await screen.findByTestId("wording-refusals")).getAllByRole("listitem");
    expect(refusals[0]).toHaveTextContent("This message cannot fill nickname.");
    expect(refusals[1]).toHaveTextContent("The text must contain username");
  });

  it("given a stale password proof, when saving, then the password is asked for and the wording is saved after it", async () => {
    // given
    const changing = vi.spyOn(api, "changeMessageTemplate")
      .mockRejectedValueOnce(new ApiError(403, { type: "urn:courtside:error:recent-authentication-required", title: "Recent authentication required", status: 403 }))
      .mockResolvedValueOnce(undefined);
    const proving = vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
    show();
    await chooseEnglish();
    await userEvent.click(screen.getByTestId("wording-save"));

    // when
    await userEvent.type(await screen.findByTestId("admin-reauthentication-password"), "admin-password");
    await userEvent.click(screen.getByTestId("admin-reauthentication-submit"));

    // then
    await waitFor(() => expect(changing).toHaveBeenCalledTimes(2));
    expect(proving).toHaveBeenCalledWith("admin-password");
    expect(changing).toHaveBeenLastCalledWith("ACCOUNT_USERNAME_REMINDER", "en", shippedEn);
    expect(await screen.findByTestId("wording-success")).toBeInTheDocument();
  });

  it("given a wrong password at the prompt, when it is confirmed, then the prompt stays with the reason and nothing is saved", async () => {
    // given
    const changing = vi.spyOn(api, "changeMessageTemplate")
      .mockRejectedValue(new ApiError(403, { type: "urn:courtside:error:recent-authentication-required", title: "Recent authentication required", status: 403 }));
    vi.spyOn(api, "reauthenticate").mockRejectedValue(new ApiError(401, { type: "urn:courtside:error:reauthentication-failed", title: "Reauthentication failed", status: 401 }));
    show();
    await screen.findByTestId("wording-body");
    await userEvent.click(screen.getByTestId("wording-save"));

    // when
    await userEvent.type(await screen.findByTestId("admin-reauthentication-password"), "wrong-password");
    await userEvent.click(screen.getByTestId("admin-reauthentication-submit"));

    // then
    expect(await screen.findByTestId("admin-reauthentication-failure")).toBeInTheDocument();
    expect(screen.getByTestId("admin-reauthentication-submit")).toBeEnabled();
    expect(changing).toHaveBeenCalledTimes(1);
  });

  it("given a club wording, when reset, then the shipped wording is shown again", async () => {
    // given
    vi.spyOn(api, "messageTemplates").mockResolvedValueOnce([reminder(own)]).mockResolvedValueOnce([reminder()]);
    const resetting = vi.spyOn(api, "resetMessageTemplate").mockResolvedValue(undefined);
    show();
    await chooseEnglish();
    expect(screen.getByTestId("wording-body")).toHaveValue(own.body);

    // when
    await userEvent.click(screen.getByTestId("wording-reset"));

    // then
    await waitFor(() => expect(screen.getByTestId("wording-body")).toHaveValue(shippedEn.body));
    expect(resetting).toHaveBeenCalledWith("ACCOUNT_USERNAME_REMINDER", "en");
    expect(screen.getByTestId("wording-state")).toHaveAttribute("data-own", "false");
  });
});
