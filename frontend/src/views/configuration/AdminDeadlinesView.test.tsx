import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError, api, type AdminClubConfig } from "../../api/client";
import i18n from "../../i18n";
import { UnsavedCount } from "../../test/UnsavedCount";
import { UnsavedChangesProvider } from "../../unsaved/UnsavedChangesProvider";
import { AdminDeadlinesView } from "./AdminDeadlinesView";

const stored: AdminClubConfig = {
  clubName: "Example Tennis Club",
  shortName: "Example",
  primaryColor: "#b85c38",
  accentColor: "#d7e24b",
  logoUrl: "/icon.svg",
  logoFallbackUrl: "/icon.svg",
  imprintUrl: "/imprint",
  privacyUrl: "/privacy",
  defaultLocale: "en",
  supportedLocales: ["de", "en"],
  slotMinutes: 30,
  timeZone: "Europe/Berlin",
  newAccountCredentialHours: 168,
  passwordResetCredentialHours: 24,
  passwordResetTokenMinutes: 60,
  bookingReminderHours: 24,
  noMembershipTypeRuleSetId: "rule-set",
  logoUploaded: false
};

function show(configurationChanged = () => undefined) {
  render(<MemoryRouter><UnsavedChangesProvider>
    <UnsavedCount />
    <AdminDeadlinesView configurationChanged={configurationChanged} />
  </UnsavedChangesProvider></MemoryRouter>);
}

describe("AdminDeadlinesView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminConfig").mockResolvedValue(stored);
  });

  it("given stored deadlines, when the page loads, then each is shown with its limits", async () => {
    // when
    show();

    // then
    expect(await screen.findByTestId("new-account-credential-hours")).toHaveValue(168);
    expect(screen.getByTestId("new-account-credential-hours")).toHaveAttribute("max", "168");
    expect(screen.getByTestId("password-reset-credential-hours")).toHaveValue(24);
    expect(screen.getByTestId("password-reset-credential-hours")).toHaveAttribute("max", "168");
    expect(screen.getByTestId("password-reset-token-minutes")).toHaveValue(60);
    expect(screen.getByTestId("booking-reminder-hours")).toHaveValue(24);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Deadlines and reminders");
  });

  it("given changed deadlines, when saving, then the request carries every other setting as it was stored", async () => {
    // given
    const changing = vi.spyOn(api, "changeAdminConfig")
      .mockResolvedValue({ ...stored, newAccountCredentialHours: 72, bookingReminderHours: 3 });
    const configurationChanged = vi.fn();
    show(configurationChanged);
    await screen.findByTestId("new-account-credential-hours");

    // when
    await userEvent.clear(screen.getByTestId("new-account-credential-hours"));
    await userEvent.type(screen.getByTestId("new-account-credential-hours"), "72");
    await userEvent.clear(screen.getByTestId("booking-reminder-hours"));
    await userEvent.type(screen.getByTestId("booking-reminder-hours"), "3");
    await userEvent.click(screen.getByTestId("save-deadlines"));

    // then
    expect(await screen.findByTestId("admin-save-success")).toHaveTextContent("The deadlines and reminders were saved.");
    expect(changing).toHaveBeenCalledWith({
      clubName: "Example Tennis Club", shortName: "Example", primaryColor: "#b85c38", accentColor: "#d7e24b",
      logoUrl: "/icon.svg", imprintUrl: "/imprint", privacyUrl: "/privacy", documentationUrl: undefined,
      defaultLocale: "en", slotMinutes: 30, timeZone: "Europe/Berlin",
      newAccountCredentialHours: 72, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 3, noMembershipTypeRuleSetId: "rule-set"
    });
    expect(configurationChanged).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  it("given another page saved the club's links after this one loaded, when the deadlines are saved, then the newer links survive", async () => {
    // given
    vi.mocked(api.adminConfig)
      .mockResolvedValueOnce(stored)
      .mockResolvedValue({ ...stored, imprintUrl: "/imprint-2", noMembershipTypeRuleSetId: "other" });
    const changing = vi.spyOn(api, "changeAdminConfig").mockResolvedValue({ ...stored, bookingReminderHours: 3 });
    show();
    await screen.findByTestId("booking-reminder-hours");

    // when
    await userEvent.clear(screen.getByTestId("booking-reminder-hours"));
    await userEvent.type(screen.getByTestId("booking-reminder-hours"), "3");
    await userEvent.click(screen.getByTestId("save-deadlines"));

    // then
    await waitFor(() => expect(changing).toHaveBeenCalledTimes(1));
    expect(changing.mock.calls[0][0], "fields the page does not own are read again just before the write")
      .toMatchObject({ imprintUrl: "/imprint-2", noMembershipTypeRuleSetId: "other", bookingReminderHours: 3 });
  });

  it("given the configuration cannot be read again, when the deadlines are saved, then nothing is written and the failure is shown", async () => {
    // given
    vi.mocked(api.adminConfig)
      .mockResolvedValueOnce(stored)
      .mockRejectedValue(new ApiError(503));
    const changing = vi.spyOn(api, "changeAdminConfig");
    show();
    await screen.findByTestId("booking-reminder-hours");
    await userEvent.type(screen.getByTestId("booking-reminder-hours"), "0");

    // when
    await userEvent.click(screen.getByTestId("save-deadlines"));

    // then
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(changing, "a write built on an unread configuration could revert another page").not.toHaveBeenCalled();
  });

  it("given the deadlines page, when it loads, then the club's identity and rules are not on it", async () => {
    // when
    show();
    await screen.findByTestId("new-account-credential-hours");

    // then
    for (const elsewhere of ["club-name", "primary-color-value", "logo-file", "time-zone", "slot-minutes",
      "no-membership-type-rule-set", "save-club-config"]) {
      expect(screen.queryByTestId(elsewhere), `${elsewhere} belongs to another surface`).not.toBeInTheDocument();
    }
  });

  it("given the short numeric fields, when the page is laid out, then they share rows instead of each spanning the page", async () => {
    // when
    show();
    await screen.findByTestId("new-account-credential-hours");

    // then
    expect(screen.getByTestId("deadline-fields")).toHaveClass("md:grid-cols-2");
    expect(screen.getByTestId("booking-reminder-hours"), "a number of hours needs no full-width input").toHaveClass("max-w-32");
  });

  it("given an edited deadline, when it is read, then it says the change is not saved", async () => {
    // given
    show();
    await screen.findByTestId("password-reset-token-minutes");

    // when
    await userEvent.type(screen.getByTestId("password-reset-token-minutes"), "0");

    // then
    expect(await screen.findByTestId("unsaved-mark-deadlines")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));
  });

  it("given an edited deadline, when it is discarded, then the stored value returns and nothing is left unsaved", async () => {
    // given
    show();
    await screen.findByTestId("password-reset-token-minutes");
    await userEvent.type(screen.getByTestId("password-reset-token-minutes"), "0");

    // when
    await userEvent.click(screen.getByTestId("discard-deadlines"));

    // then
    expect(screen.getByTestId("password-reset-token-minutes")).toHaveValue(60);
    expect(screen.queryByTestId("save-deadlines")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  it("given untouched deadlines, when the page loads, then no save is offered", async () => {
    // when
    show();
    await screen.findByTestId("password-reset-token-minutes");

    // then
    expect(screen.queryByTestId("save-deadlines")).not.toBeInTheDocument();
  });

  it("given the API rejects a deadline, when saving, then its validation code is reported", async () => {
    // given
    vi.spyOn(api, "changeAdminConfig").mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:validation",
      title: "Validation failed",
      status: 400,
      fieldErrors: [{ field: "passwordResetTokenMinutes", code: "validation.Max", params: { value: 1440 } }]
    }));
    show();
    await screen.findByTestId("password-reset-token-minutes");
    await userEvent.type(screen.getByTestId("password-reset-token-minutes"), "0");

    // when
    await userEvent.click(screen.getByTestId("save-deadlines"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("1440");
    expect(screen.getByTestId("unsaved-mark-deadlines"), "a refused save leaves the work unsaved").toBeVisible();
  });

  it("given the configuration cannot load, when opening the page, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "adminConfig").mockRejectedValue(new Error("unavailable"));

    // when
    show();

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("save-deadlines")).not.toBeInTheDocument();
  });
});
