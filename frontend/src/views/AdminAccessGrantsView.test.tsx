import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type AccessGrantOverview, type AdminAccessGrant, type ClubConfig } from "../api/client";
import i18n from "../i18n";
import { WithClubConfiguration } from "../test/ClubConfiguration";
import { AdminAccessGrantsView } from "./AdminAccessGrantsView";

const club: ClubConfig = {
  clubName: "Example Tennis Club", primaryColor: "#000000", accentColor: "#ffffff",
  logoUrl: null, imprintUrl: null, defaultLocale: "en", supportedLocales: ["de", "en"],
  slotMinutes: 60, timeZone: "Europe/Berlin"
};

function grant(overrides: Partial<AdminAccessGrant> = {}): AdminAccessGrant {
  return {
    id: "grant-1", bookingId: "booking-1", status: "INSTALLED",
    validFrom: "2026-05-14T15:45:00Z", validUntil: "2026-05-14T17:45:00Z",
    startsAt: "2026-05-14T16:00:00Z", endsAt: "2026-05-14T17:30:00Z",
    courts: [{ number: 1, name: "Court 1" }], accessPoints: ["North gate"],
    attempts: 0, lastFailure: null, nextAttemptAt: null,
    ...overrides
  };
}

function overview(grants: AdminAccessGrant[], overrides: Partial<AccessGrantOverview> = {}): AccessGrantOverview {
  return {
    connector: "simulated", connected: true,
    probe: { reachable: true, outcome: "ANSWERED", detail: "", checkedAt: "2026-05-12T10:00:00Z" },
    grants, total: grants.length, ...overrides
  };
}

function show() {
  render(<WithClubConfiguration club={club}><AdminAccessGrantsView /></WithClubConfiguration>);
}

describe("AdminAccessGrantsView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given a failing and an installed grant, when the page opens, then only the failing one offers to send it again", async () => {
    // given
    vi.spyOn(api, "adminAccessGrants").mockResolvedValue(overview([
      grant({ id: "grant-2", bookingId: "booking-2", status: "FAILING", attempts: 5, lastFailure: "Timed out" }),
      grant()
    ]));

    // when
    show();

    // then
    const failing = await screen.findByTestId("access-grant-booking-2");
    expect(failing, "a failing grant is marked as failing").toHaveAttribute("data-status", "FAILING");
    expect(within(failing).getByTestId("access-grant-failure")).toHaveTextContent("Failed 5 times, last: Timed out");
    expect(within(failing).getByTestId("access-grant-retry")).toBeEnabled();
    const installed = screen.getByTestId("access-grant-booking-1");
    expect(within(installed).getByTestId("access-grant-status")).toHaveTextContent("Installed");
    expect(within(installed).getByTestId("access-grant-window")).toHaveTextContent("North gate");
    expect(within(installed).queryByTestId("access-grant-retry"), "an installed grant needs no retry").toBeNull();
  });

  it("given a grant being removed, when the page opens, then it shows its status without a window or a retry", async () => {
    // given
    vi.spyOn(api, "adminAccessGrants").mockResolvedValue(overview([
      grant({ status: "REMOVING", validFrom: null, validUntil: null, attempts: 1, lastFailure: "busy" })
    ]));

    // when
    show();

    // then
    const removing = await screen.findByTestId("access-grant-booking-1");
    expect(within(removing).getByTestId("access-grant-status")).toHaveTextContent("Being removed");
    expect(within(removing).queryByTestId("access-grant-window"), "a grant no longer wanted has no window").toBeNull();
    expect(within(removing).queryByTestId("access-grant-retry"), "only a failing grant is retried").toBeNull();
  });

  it("given a failing grant, when the board sends it again, then the retry is requested and the list reloads", async () => {
    // given
    const list = vi.spyOn(api, "adminAccessGrants")
      .mockResolvedValueOnce(overview([grant({ status: "FAILING", attempts: 1, lastFailure: "Unreachable" })]))
      .mockResolvedValueOnce(overview([grant({ status: "WAITING" })]));
    const retry = vi.spyOn(api, "retryAdminAccessGrant").mockResolvedValue(grant({ status: "WAITING" }));
    show();

    // when
    await userEvent.click(await screen.findByTestId("access-grant-retry"));

    // then
    expect(retry).toHaveBeenCalledWith("grant-1");
    await waitFor(() => expect(screen.getByTestId("access-grant-booking-1")).toHaveAttribute("data-status", "WAITING"));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("given a grant that is no longer failing, when the board sends it again, then the refusal is explained", async () => {
    // given
    vi.spyOn(api, "adminAccessGrants").mockResolvedValue(overview([grant({ status: "FAILING", attempts: 5, lastFailure: "Unknown user" })]));
    vi.spyOn(api, "retryAdminAccessGrant").mockRejectedValue(new ApiError(409, {
      type: "urn:courtside:error:access-grant-not-failing", title: "Access grant not failing", status: 409,
      violations: [{ code: "access.grant.notFailing", params: { status: "INSTALLED" } }]
    }));
    show();

    // when
    await userEvent.click(await screen.findByTestId("access-grant-retry"));

    // then
    expect(await screen.findByTestId("access-grants-problem"))
      .toHaveTextContent("Only a failing access grant can be sent again.");
  });

  it("given a probe that timed out, when the page opens, then the board reads its class and no connector detail", async () => {
    // given
    vi.spyOn(api, "adminAccessGrants").mockResolvedValue(overview([], {
      probe: { reachable: false, outcome: "TIMEOUT", detail: "", checkedAt: "2026-05-12T10:00:00Z" }
    }));

    // when
    show();

    // then
    const probe = await screen.findByTestId("access-grants-probe");
    expect(probe, "the probe names its class").toHaveAttribute("data-outcome", "TIMEOUT");
    expect(probe).toHaveTextContent("did not answer in time");
    expect(screen.queryByTestId("access-grants-probe-detail"), "an empty detail is not shown").toBeNull();
  });

  it("given a connector that refused with its own reason, when the page opens, then the board reads both", async () => {
    // given
    vi.spyOn(api, "adminAccessGrants").mockResolvedValue(overview([], {
      probe: { reachable: false, outcome: "REFUSED", detail: "403 no user management", checkedAt: "2026-05-12T10:00:00Z" }
    }));

    // when
    show();

    // then
    expect(await screen.findByTestId("access-grants-probe")).toHaveTextContent("does not let Courtside manage users");
    expect(screen.getByTestId("access-grants-probe-detail")).toHaveTextContent("403 no user management");
  });

  it("given no probe since the start, when the board asks for one, then it is requested and the board learns when it runs", async () => {
    // given
    vi.spyOn(api, "adminAccessGrants").mockResolvedValue(overview([], { probe: null }));
    const probe = vi.spyOn(api, "probeAccessControl").mockResolvedValue(undefined);
    show();
    expect(await screen.findByTestId("access-grants-probe")).toHaveAttribute("data-outcome", "none");

    // when
    await userEvent.click(screen.getByTestId("access-grants-probe-now"));

    // then
    expect(probe).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("access-grants-probe-requested")).toHaveTextContent("next pass");
  });

  it("given no access-control system, when the page opens, then it says that bookings receive no individual codes", async () => {
    // given
    vi.spyOn(api, "adminAccessGrants").mockResolvedValue(overview([], { connector: "none", connected: false, probe: null }));

    // when
    show();

    // then
    expect(await screen.findByTestId("access-grants-connector"))
      .toHaveTextContent("No access-control system is connected");
    expect(screen.queryByTestId("access-grants-probe-now"), "nothing to probe without a system").toBeNull();
    expect(screen.getByTestId("access-grants-empty")).toBeInTheDocument();
  });
});
