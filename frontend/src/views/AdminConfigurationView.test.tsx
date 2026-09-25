import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError, api } from "../api/client";
import i18n from "../i18n";
import { UnsavedCount } from "../test/UnsavedCount";
import { UnsavedChangesProvider } from "../unsaved/UnsavedChangesProvider";
import { AdminConfigurationView } from "./AdminConfigurationView";

describe("AdminConfigurationView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminConfig").mockResolvedValue({
      clubName: "Example Tennis Club",
      primaryColor: "#b85c38",
      accentColor: "#d7e24b",
      defaultLocale: "en",
      supportedLocales: ["de", "en"],
      slotMinutes: 30,
      timeZone: "Europe/Berlin",
      newAccountCredentialHours: 168,
      passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24,
      logoUploaded: false
    });
    vi.spyOn(api, "ruleSets").mockResolvedValue([]);
  });

  it("when the page is shown, then its content keeps a readable line length", () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(screen.getByTestId("admin-configuration-view")).toHaveClass("[&>*]:max-w-5xl");
    expect(screen.getByTestId("admin-configuration-view")).toHaveClass("min-w-0");
    expect(screen.getByTestId("admin-configuration-view")).toHaveClass("[&>*]:min-w-0");
  });

  it("given a privacy policy the club publishes, when saving, then the link is written", async () => {
    // given
    const changing = vi.spyOn(api, "changeAdminConfig").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24, logoUploaded: false, privacyUrl: "/privacy"
    });
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("privacy-url");

    // when
    await userEvent.type(screen.getByTestId("privacy-url"), "/privacy");
    await userEvent.click(screen.getByTestId("save-club-config"));

    // then
    await waitFor(() => expect(changing).toHaveBeenCalledWith(
      expect.objectContaining({ privacyUrl: "/privacy" })));
  });

  it("given a documentation target, when saving, then the override is written", async () => {
    // given
    const changing = vi.spyOn(api, "changeAdminConfig").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24,
      passwordResetTokenMinutes: 60, bookingReminderHours: 24, logoUploaded: false,
      documentationUrl: "https://docs.example.org/courtside"
    });
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("documentation-url");

    // when
    await userEvent.type(screen.getByTestId("documentation-url"), "https://docs.example.org/courtside");
    await userEvent.click(screen.getByTestId("save-club-config"));

    // then
    await waitFor(() => expect(changing).toHaveBeenCalledWith(
      expect.objectContaining({ documentationUrl: "https://docs.example.org/courtside" })));
  });

  it("given a short name for the app icon, when saving, then the club's choice is written", async () => {
    // given
    const changing = vi.spyOn(api, "changeAdminConfig").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24,
      passwordResetTokenMinutes: 60, bookingReminderHours: 24, logoUploaded: false,
      shortName: "ETC Example"
    });
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("short-name");

    // when
    await userEvent.type(screen.getByTestId("short-name"), "ETC Example");
    await userEvent.click(screen.getByTestId("save-club-config"));

    // then
    await waitFor(() => expect(changing).toHaveBeenCalledWith(
      expect.objectContaining({ shortName: "ETC Example" })));
  });

  it("given the short name field, when a board types past what fits under an icon, then the field stops at twelve characters", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("short-name");

    // when
    await userEvent.type(screen.getByTestId("short-name"), "Example Tennis Club");

    // then
    expect(screen.getByTestId("short-name")).toHaveValue("Example Tenn");
  });

  it("given a stored short name, when it is cleared, then the manifest can derive one again", async () => {
    // given
    vi.spyOn(api, "adminConfig").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24,
      passwordResetTokenMinutes: 60, bookingReminderHours: 24, logoUploaded: false,
      shortName: "ETC Example"
    });
    const changing = vi.spyOn(api, "changeAdminConfig").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24,
      passwordResetTokenMinutes: 60, bookingReminderHours: 24, logoUploaded: false
    });
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("short-name")).toHaveValue("ETC Example"));

    // when
    await userEvent.clear(screen.getByTestId("short-name"));
    await userEvent.click(screen.getByTestId("save-club-config"));

    // then
    await waitFor(() => expect(changing).toHaveBeenCalledWith(
      expect.objectContaining({ shortName: null })));
  });

  it("given stored brand colours, when choosing a new primary colour, then the field and live contrast preview agree", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    const picker = await screen.findByTestId("primary-color-picker");

    // when
    fireEvent.change(picker, { target: { value: "#777777" } });

    // then
    expect(screen.getByTestId("primary-color-value")).toHaveValue("#777777");
    expect(screen.getByTestId("primary-color-preview")).toHaveStyle({ backgroundColor: "#777777" });
    expect(screen.getByTestId("primary-color-contrast")).toHaveTextContent("4.33:1");
    expect(screen.getByTestId("primary-color-contrast")).toHaveTextContent("does not reach 4.5:1");
    expect(screen.getByTestId("primary-color-contrast").className, "a failing ratio is shown in the warning tone")
      .toContain("bg-(--cs-notice-warning-surface)");
  });

  it("given a primary colour that passes, when a new one fails, then the same live region reports the change", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    const picker = await screen.findByTestId("primary-color-picker");
    fireEvent.change(picker, { target: { value: "#17211d" } });
    const passing = screen.getByTestId("primary-color-contrast");
    expect(passing).toHaveTextContent("reaches 4.5:1");

    // when
    fireEvent.change(picker, { target: { value: "#777777" } });

    // then
    expect(screen.getByTestId("primary-color-contrast"), "a region inserted with its content is not announced").toBe(passing);
    expect(passing).toHaveTextContent("does not reach 4.5:1");
    expect(passing.tagName, "a computed result stays an output").toBe("OUTPUT");
  });

  it("given a high contrast accent colour, when it is shown, then the preview names the automatic text tone", async () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("accent-color-picker")).toHaveValue("#d7e24b");
    expect(screen.getByTestId("accent-color-contrast")).toHaveTextContent("Dark text");
    expect(screen.getByTestId("accent-color-contrast")).toHaveTextContent("reaches 4.5:1");
    expect(screen.getByTestId("accent-color-contrast").className, "a passing ratio carries no warning")
      .not.toContain("--cs-notice-warning");
  });

  it("given a board logo file, when uploading it, then the effective preview and shell configuration change", async () => {
    // given
    const uploaded = {
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24, logoUploaded: true, logoFallbackUrl: "/fallback.svg",
      logoUrl: `/api/public/config/logo?v=${"a".repeat(64)}`
    };
    const upload = vi.spyOn(api, "uploadClubLogo").mockResolvedValue(uploaded);
    const configurationChanged = vi.fn();
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={configurationChanged} /></UnsavedChangesProvider></MemoryRouter>);
    const input = await screen.findByTestId("logo-file");
    const file = new File([new Uint8Array([1, 2, 3])], "club.png", { type: "image/png" });

    // when
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByTestId("upload-logo"));

    // then
    await waitFor(() => expect(upload).toHaveBeenCalledWith(file));
    expect(screen.getByTestId("logo-preview")).toHaveAttribute("src", uploaded.logoUrl);
    expect(configurationChanged).toHaveBeenCalledWith(uploaded);
  });

  it.each([
    ["an active-content file", new File(["<svg/>"] , "club.svg", { type: "image/svg+xml" }),
      "The logo must be a valid PNG or JPEG file."],
    ["a file above one mebibyte", new File([new Uint8Array(1024 * 1024 + 1)], "club.png", { type: "image/png" }),
      "The logo file must not exceed 1 MiB."]
  ])("given %s, when selecting it, then it is rejected before upload", async (_case, file, message) => {
    // given
    const upload = vi.spyOn(api, "uploadClubLogo");
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    const input = await screen.findByTestId("logo-file");
    const user = userEvent.setup({ applyAccept: false });

    // when
    await user.upload(input, file);

    // then
    expect(await screen.findByTestId("admin-error")).toHaveTextContent(message);
    expect(upload).not.toHaveBeenCalled();
  });

  it("given an uploaded logo and a URL fallback, when removing it, then the fallback becomes the preview", async () => {
    // given
    vi.spyOn(api, "adminConfig").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24, logoUploaded: true, logoFallbackUrl: "/fallback.svg",
      logoUrl: `/api/public/config/logo?v=${"a".repeat(64)}`
    });
    const removed = {
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24, logoUploaded: false, logoFallbackUrl: "/fallback.svg",
      logoUrl: "/fallback.svg"
    };
    const remove = vi.spyOn(api, "deleteClubLogo").mockResolvedValue(removed);
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("remove-logo");

    // when
    await userEvent.click(screen.getByTestId("remove-logo"));

    // then
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(screen.getByTestId("logo-preview")).toHaveAttribute("src", "/fallback.svg");
    expect(screen.queryByTestId("remove-logo")).not.toBeInTheDocument();
  });

  it("given the server rejects a selected image, when uploading it, then the typed reason is shown", async () => {
    // given
    vi.spyOn(api, "uploadClubLogo").mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:invalid-club-logo", title: "Invalid club logo", status: 400,
      detail: "The uploaded club logo is not usable",
      violations: [{ code: "config.logo.dimensions", params: {} }]
    }));
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    const input = await screen.findByTestId("logo-file");
    await userEvent.upload(input, new File([new Uint8Array([1])], "club.png", { type: "image/png" }));

    // when
    await userEvent.click(screen.getByTestId("upload-logo"));

    // then
    expect(await screen.findByTestId("admin-error")).toHaveTextContent(
      "The logo must not exceed 2048 by 2048 pixels.");
  });

  it("given an upload is pending, when its button is pressed again, then one request owns the mutation", async () => {
    // given
    const result = deferred<Awaited<ReturnType<typeof api.uploadClubLogo>>>();
    const upload = vi.spyOn(api, "uploadClubLogo").mockReturnValue(result.promise);
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    const input = await screen.findByTestId("logo-file");
    await userEvent.upload(input, new File([new Uint8Array([1])], "club.png", { type: "image/png" }));

    // when
    await userEvent.click(screen.getByTestId("upload-logo"));
    await userEvent.click(screen.getByTestId("upload-logo"));

    // then
    expect(upload).toHaveBeenCalledOnce();
    expect(screen.getByTestId("upload-logo")).toBeDisabled();
    expect(screen.getByTestId("save-club-config")).toBeDisabled();
  });

  it("given a stored privacy policy link, when it is cleared, then the club is not stuck with it", async () => {
    // given
    vi.spyOn(api, "adminConfig").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24, logoUploaded: false, privacyUrl: "/privacy"
    });
    const changing = vi.spyOn(api, "changeAdminConfig").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24, logoUploaded: false
    });
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("privacy-url");

    // when
    await userEvent.clear(screen.getByTestId("privacy-url"));
    await userEvent.click(screen.getByTestId("save-club-config"));

    // then
    await waitFor(() => expect(changing).toHaveBeenCalledWith(
      expect.objectContaining({ privacyUrl: null })));
  });

  it("given a stored documentation override, when it is cleared, then the default can take over", async () => {
    // given
    vi.spyOn(api, "adminConfig").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24,
      passwordResetTokenMinutes: 60, bookingReminderHours: 24, logoUploaded: false,
      documentationUrl: "https://docs.example.org/courtside"
    });
    const changing = vi.spyOn(api, "changeAdminConfig").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24,
      passwordResetTokenMinutes: 60, bookingReminderHours: 24, logoUploaded: false
    });
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("documentation-url");

    // when
    await userEvent.clear(screen.getByTestId("documentation-url"));
    await userEvent.click(screen.getByTestId("save-club-config"));

    // then
    await waitFor(() => expect(changing).toHaveBeenCalledWith(
      expect.objectContaining({ documentationUrl: null })));
  });

  it("given an admin, when the club page loads, then the club's settings are visible", async () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("club-name")).toHaveValue("Example Tennis Club");
    expect(screen.getByTestId("slot-minutes")).toHaveValue(30);
    expect(screen.getByTestId("slot-minutes")).toHaveAttribute("id", "slot-minutes");
    expect(screen.getByTestId("time-zone")).toHaveValue("Europe/Berlin");
  });

  it("given the club page, when it loads, then deadlines and booking rules live on pages of their own", async () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("club-name");

    // then
    for (const elsewhere of ["new-account-credential-hours", "password-reset-credential-hours", "password-reset-token-minutes",
      "booking-reminder-hours", "no-membership-type-rule-set", "booking-rules", "rule-set-overview"]) {
      expect(screen.queryByTestId(elsewhere), `${elsewhere} belongs to another surface`).not.toBeInTheDocument();
    }
    expect(api.ruleSets, "the club page has no use for rule sets").not.toHaveBeenCalled();
  });

  it("given the club page, when it is laid out at desktop width, then its groups stand side by side", async () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("club-name");

    // then
    const columns = screen.getByTestId("club-profile-columns");
    expect(columns, "identity, settings and appearance share one row").toHaveClass("xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.25fr)]");
    expect(screen.getByTestId("club-appearance"), "both colours and the logo take half the row").toHaveClass("lg:col-span-2");
    for (const field of ["club-name", "short-name", "imprint-url", "privacy-url"]) {
      expect(screen.getByTestId("club-identity"), `${field} is part of the identity`).toContainElement(screen.getByTestId(field));
    }
    for (const field of ["documentation-url", "default-locale", "time-zone", "slot-minutes"]) {
      expect(screen.getByTestId("club-settings"), `${field} is part of the settings`).toContainElement(screen.getByTestId(field));
    }
    expect(screen.getByTestId("slot-minutes"), "a number of minutes needs no full-width input").toHaveClass("max-w-32");
  });

  it("given the time-grid fragment, when configuration loads, then the owned setting receives focus", async () => {
    // given
    render(<MemoryRouter initialEntries={["/admin/configuration#slot-minutes"]}><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

    // when
    const slotMinutes = await screen.findByTestId("slot-minutes");

    // then
    await waitFor(() => expect(slotMinutes).toHaveFocus());
  });

  it("given configuration cannot load, when opening the view, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "adminConfig").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("given changed club settings, when saving, then the whole configuration is written with them", async () => {
    // given
    const changeConfig = vi.spyOn(api, "changeAdminConfig").mockResolvedValue({
      clubName: "Example Racquet Club",
      primaryColor: "#b85c38",
      accentColor: "#d7e24b",
      defaultLocale: "en",
      supportedLocales: ["de", "en"],
      slotMinutes: 15,
      timeZone: "Pacific/Auckland",
      newAccountCredentialHours: 168,
      passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24, logoUploaded: false
    });
    const configurationChanged = vi.fn();
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={configurationChanged} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("club-name");

    // when
    fireEvent.change(screen.getByTestId("club-name"), { target: { value: "Example Racquet Club" } });
    fireEvent.change(screen.getByTestId("slot-minutes"), { target: { value: "15" } });
    fireEvent.change(screen.getByTestId("time-zone"), { target: { value: "Pacific/Auckland" } });
    fireEvent.click(screen.getByTestId("save-club-config"));

    // then
    await waitFor(() => expect(configurationChanged).toHaveBeenCalled());
    expect(changeConfig).toHaveBeenCalledWith(expect.objectContaining({
      clubName: "Example Racquet Club", slotMinutes: 15, timeZone: "Pacific/Auckland",
      newAccountCredentialHours: 168, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24, noMembershipTypeRuleSetId: null
    }));
    // What the instance ships is read from the response and never sent back: the request refuses it
    expect(changeConfig.mock.calls[0][0]).not.toHaveProperty("supportedLocales");
  });

  it("given a typed club name, when the language changes, then nothing is fetched again", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("club-name");
    fireEvent.change(screen.getByTestId("club-name"), { target: { value: "Example Racquet Club" } });
    const reads = vi.mocked(api.adminConfig).mock.calls.length;

    // when
    await act(() => i18n.changeLanguage("de"));

    // then
    expect(screen.getByTestId("save-club-config")).toHaveTextContent("Speichern");
    expect(vi.mocked(api.adminConfig).mock.calls.length, "no load runs again").toBe(reads);
    expect(screen.getByTestId("club-name")).toHaveValue("Example Racquet Club");
  });

  it("given the API rejects a club setting, when saving, then its validation code is reported", async () => {
    // given
    vi.spyOn(api, "changeAdminConfig").mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:validation",
      title: "Validation failed",
      status: 400,
      fieldErrors: [{ field: "primaryColor", code: "validation.Pattern", params: {} }]
    }));
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("club-name");

    // when
    await userEvent.click(screen.getByTestId("save-club-config"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("The input does not have the permitted format.");
  });

  it("offers the club time zone as a list of known zones", async () => {
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

    const field = await screen.findByTestId("time-zone");

    expect(field.tagName).toBe("SELECT");
    const optionValues = within(field).getAllByRole("option").map((option) => (option as HTMLOptionElement).value);
    expect(optionValues).toContain("Europe/Berlin");
  });

  it("given a stored time zone the browser does not list, when configuration loads, then the control still shows it", async () => {
    // given
    vi.spyOn(api, "adminConfig").mockResolvedValue({
      clubName: "Example Tennis Club",
      primaryColor: "#b85c38",
      accentColor: "#d7e24b",
      defaultLocale: "en",
      supportedLocales: ["de", "en"],
      slotMinutes: 30,
      timeZone: "US/Eastern",
      newAccountCredentialHours: 168,
      passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24, logoUploaded: false
    });

    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminConfigurationView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("time-zone")).toHaveValue("US/Eastern");
  });

  it("given the configuration is edited, when the edit is taken back, then nothing is left to lose", async () => {
    // given
    vi.spyOn(api, "adminConfig").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24, logoUploaded: false, privacyUrl: "/privacy"
    });
    render(<MemoryRouter><UnsavedChangesProvider>
      <UnsavedCount />
      <AdminConfigurationView configurationChanged={() => undefined} />
    </UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("privacy-url");
    expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0");

    // when
    await userEvent.type(screen.getByTestId("privacy-url"), "-v2");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));

    // when
    await userEvent.clear(screen.getByTestId("privacy-url"));
    await userEvent.type(screen.getByTestId("privacy-url"), "/privacy");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
