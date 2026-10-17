import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ClubConfig, type OperatorHealth } from "../api/client";
import i18n from "../i18n";
import { WithClubConfiguration } from "../test/ClubConfiguration";
import { AdminOperatorHealthView } from "./AdminOperatorHealthView";

const club: ClubConfig = {
  clubName: "Example Tennis Club", primaryColor: "#000000", accentColor: "#ffffff",
  logoUrl: null, imprintUrl: null, defaultLocale: "en", supportedLocales: ["de", "en"],
  slotMinutes: 60, timeZone: "Europe/Berlin"
};

function overview(overrides: Partial<OperatorHealth> = {}): OperatorHealth {
  return {
    checkedAt: "2026-10-17T08:00:00Z",
    version: { state: "OK", version: "0.4.0", revision: "0123abc", builtAt: "2026-10-16T20:00:00Z" },
    migrations: { state: "OK", pending: 0, currentVersion: "63", expectedVersion: "63" },
    mail: { state: "FAILING", reason: "HANDOVER_FAILING", lastHandedOverAt: "2026-10-17T07:00:00Z", location: "relay.example.org:587" },
    publicOrigin: { state: "OK", origin: "https://courts.example.org" },
    backup: { state: "UNAVAILABLE", reason: "NOT_CONFIGURED" },
    ...overrides
  };
}

function show() {
  render(<WithClubConfiguration club={club}><AdminOperatorHealthView /></WithClubConfiguration>);
}

describe("AdminOperatorHealthView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given one check in each state, when the overview opens, then each names its state and a failing one names its place", async () => {
    // given
    vi.spyOn(api, "operatorHealth").mockResolvedValue(overview());

    // when
    show();

    // then
    const mail = await screen.findByTestId("operator-check-mail");
    expect(mail, "a failing check is marked as failing").toHaveAttribute("data-state", "FAILING");
    expect(within(mail).getByTestId("operator-check-mail-state")).toHaveTextContent("Failing");
    expect(within(mail).getByTestId("operator-check-mail-detail")).toHaveTextContent("relay.example.org:587");
    const origin = screen.getByTestId("operator-check-publicOrigin");
    expect(within(origin).getByTestId("operator-check-publicOrigin-state")).toHaveTextContent("Healthy");
    expect(within(origin).getByTestId("operator-check-publicOrigin-detail")).toHaveTextContent("https://courts.example.org");
    expect(within(screen.getByTestId("operator-check-version")).getByTestId("operator-check-version-detail"))
      .toHaveTextContent("0.4.0");
  });

  it("given a check without evidence, when the overview opens, then it reads as not healthy rather than as fine", async () => {
    // given
    vi.spyOn(api, "operatorHealth").mockResolvedValue(overview());

    // when
    show();

    // then
    const backup = await screen.findByTestId("operator-check-backup");
    expect(backup).toHaveAttribute("data-state", "UNAVAILABLE");
    expect(within(backup).getByTestId("operator-check-backup-state")).toHaveTextContent("Not evidenced");
    expect(within(backup).getByTestId("operator-check-backup-state"), "unavailable never borrows the healthy wording")
      .not.toHaveTextContent("Healthy");
    expect(within(backup).getByTestId("operator-check-backup-not-healthy")).toHaveTextContent(/not count this check as healthy/i);
    expect(backup.className, "an unavailable check is drawn apart from a healthy one").toContain("border-dashed");
    expect(screen.getByTestId("operator-health-unavailable-meaning")).toHaveTextContent(/does not mean healthy/i);
    expect(screen.queryByTestId("operator-check-mail-not-healthy"), "only unavailable checks carry the hint").toBeNull();
  });

  it("given pending migrations and a recorded backup, when the overview opens, then the count, first version and age are shown", async () => {
    // given
    vi.spyOn(api, "operatorHealth").mockResolvedValue(overview({
      migrations: { state: "FAILING", reason: "PENDING_MIGRATIONS", pending: 2, currentVersion: "62", expectedVersion: "64", location: "63" },
      backup: { state: "OK", completedAt: "2026-10-17T02:00:00Z", ageSeconds: 21_600 }
    }));

    // when
    show();

    // then
    expect(await screen.findByTestId("operator-check-migrations-detail"))
      .toHaveTextContent("2 migrations are still pending, starting with 63.");
    expect(screen.getByTestId("operator-check-backup-detail")).toHaveTextContent("6 hours ago");
  });

  it("given the overview has opened, when time passes, then it reads again only when asked", async () => {
    // given
    const read = vi.spyOn(api, "operatorHealth").mockResolvedValue(overview());
    show();
    await screen.findByTestId("operator-check-mail");

    // when
    await new Promise((resolve) => setTimeout(resolve, 50));

    // then
    expect(read, "the page opened and read once, it does not poll").toHaveBeenCalledTimes(1);

    // when
    await userEvent.click(screen.getByTestId("operator-health-refresh"));

    // then
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it("given the overview cannot be read, when it opens, then the failure offers another attempt", async () => {
    // given
    const read = vi.spyOn(api, "operatorHealth").mockRejectedValueOnce(new Error("offline")).mockResolvedValue(overview());

    // when
    show();
    await userEvent.click(await screen.findByTestId("retry-load"));

    // then
    expect(await screen.findByTestId("operator-check-mail")).toBeVisible();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
