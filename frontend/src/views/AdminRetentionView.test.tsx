import type { ComponentType, ReactNode } from "react";
import { SecurityKeyFailure } from "../security/webauthn";
import { proofOwnerHarness } from "../test/ProofOwner";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type RetentionPolicy, type RetentionPreview, type RetentionRun } from "../api/client";
import i18n from "../i18n";
import { WithClubConfiguration } from "../test/ClubConfiguration";
import { AdminRetentionView } from "./AdminRetentionView";

const MARY = "00000000-0000-0000-0000-000000000103";
const RICHARD = "00000000-0000-0000-0000-000000000106";
const PREVIEW = "6a000000-0000-0000-0000-000000000001";

const unset: RetentionPolicy[] = [{ category: "BOOKINGS", retainMonths: null }, { category: "FORMER_MEMBERS", retainMonths: null }];
const configured: RetentionPolicy[] = [{ category: "BOOKINGS", retainMonths: 24 }, { category: "FORMER_MEMBERS", retainMonths: 12 }];

const preview: RetentionPreview = {
  previewId: PREVIEW,
  expiresAt: "2026-10-17T10:30:00Z",
  bookings: { endedBefore: "2024-10-16T11:00:00Z", bookings: 41, series: 2 },
  formerMembers: { membershipEndedBefore: "2025-10-17", people: 3, accounts: 2 },
  blocked: [{ personId: MARY, reason: "NAMED_IN_BOOKINGS" }, { personId: RICHARD, reason: "ADMINISTRATOR" }]
};

const run: RetentionRun = {
  runId: "6b000000-0000-0000-0000-000000000001",
  bookingsPseudonymised: 41, seriesPseudonymised: 2, formerMembersRemoved: 3, accountsRemoved: 2, formerMembersSkipped: 0
};

const recentAuthenticationRequired = new ApiError(403, {
  type: "urn:courtside:error:recent-authentication-required", title: "Forbidden", status: 403
});

function show(wrapper?: ComponentType<{ children: ReactNode }>) {
  return render(<MemoryRouter><WithClubConfiguration><AdminRetentionView /></WithClubConfiguration></MemoryRouter>, { wrapper });
}

async function previewed() {
  vi.spyOn(api, "retentionPolicies").mockResolvedValue(configured);
  vi.spyOn(api, "previewRetention").mockResolvedValue(preview);
  show();
  await userEvent.click(await screen.findByTestId("retention-preview"));
  await screen.findByTestId("retention-preview-result");
}

describe("AdminRetentionView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given no period in either category, when the page opens, then both say nothing is removed and no preview can be taken", async () => {
    // given
    vi.spyOn(api, "retentionPolicies").mockResolvedValue(unset);

    // when
    show();

    // then
    expect(await screen.findByTestId("retention-state-BOOKINGS")).toHaveAttribute("data-configured", "false");
    expect(screen.getByTestId("retention-state-FORMER_MEMBERS")).toHaveTextContent(i18n.t("admin.retention.notSet"));
    expect(screen.getByTestId("retention-remove-BOOKINGS"), "an unset period has nothing to remove").toBeDisabled();
    expect(screen.getByTestId("retention-preview"), "a preview without any period would only be refused").toBeDisabled();
  });

  it("given a board that types a period, when it is saved, then the instance stores those months and the page shows them", async () => {
    // given
    const reads = vi.spyOn(api, "retentionPolicies").mockResolvedValueOnce(unset)
      .mockResolvedValueOnce([{ category: "BOOKINGS", retainMonths: 24 }, { category: "FORMER_MEMBERS", retainMonths: null }]);
    const setting = vi.spyOn(api, "setRetentionPolicy").mockResolvedValue({ category: "BOOKINGS", retainMonths: 24 });
    show();
    await userEvent.type(await screen.findByTestId("retention-months-BOOKINGS"), "24");

    // when
    await userEvent.click(screen.getByTestId("retention-save-BOOKINGS"));

    // then
    expect(await screen.findByTestId("retention-success")).toBeVisible();
    expect(setting).toHaveBeenCalledExactlyOnceWith("BOOKINGS", 24);
    expect(reads).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("retention-state-BOOKINGS")).toHaveTextContent(i18n.t("admin.retention.kept", { count: 24 }));
    expect(screen.getByTestId("retention-preview")).toBeEnabled();
  });

  it("given a period the instance refuses, when it is saved, then its translated refusal is shown", async () => {
    // given
    vi.spyOn(api, "retentionPolicies").mockResolvedValue(unset);
    vi.spyOn(api, "setRetentionPolicy").mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:retention-period-invalid", title: "Bad Request", status: 400
    }));
    show();
    await userEvent.type(await screen.findByTestId("retention-months-FORMER_MEMBERS"), "1201");

    // when
    await userEvent.click(screen.getByTestId("retention-save-FORMER_MEMBERS"));

    // then
    expect(await screen.findByTestId("retention-error")).toHaveTextContent(i18n.t("error.type.retention-period-invalid"));
  });

  it("given a set period, when it is removed, then the instance forgets it and an earlier preview is dropped", async () => {
    // given
    await previewed();
    const removing = vi.spyOn(api, "removeRetentionPolicy").mockResolvedValue(undefined);
    vi.spyOn(api, "retentionPolicies").mockResolvedValue([{ category: "BOOKINGS", retainMonths: 24 }, { category: "FORMER_MEMBERS", retainMonths: null }]);

    // when
    await userEvent.click(screen.getByTestId("retention-remove-FORMER_MEMBERS"));

    // then
    expect(await screen.findByTestId("retention-success")).toBeVisible();
    expect(removing).toHaveBeenCalledExactlyOnceWith("FORMER_MEMBERS");
    expect(screen.getByTestId("retention-state-FORMER_MEMBERS")).toHaveAttribute("data-configured", "false");
    expect(screen.queryByTestId("retention-preview-result"), "a preview taken under the old period is not offered").toBeNull();
  });

  it("given a preview, when it is shown, then it counts both categories and names each blocked person with the translated reason", async () => {
    // when
    await previewed();

    // then
    expect(screen.getByTestId("retention-preview-bookings")).toHaveTextContent("41 bookings, 2 series");
    expect(screen.getByTestId("retention-preview-former-members")).toHaveTextContent("3 former members with 2 accounts");
    const rows = within(screen.getByTestId("retention-blocked")).getAllByTestId("retention-blocked-row");
    expect(rows.map((row) => row.dataset.reason)).toEqual(["NAMED_IN_BOOKINGS", "ADMINISTRATOR"]);
    expect(rows[0]).toHaveTextContent(i18n.t("admin.retention.reason.NAMED_IN_BOOKINGS"));
    expect(rows[1]).toHaveTextContent(i18n.t("admin.retention.reason.ADMINISTRATOR"));
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", `/admin/roster/${MARY}`);
  });

  it("given a preview that blocks nobody, when it is shown, then it says so", async () => {
    // given
    vi.spyOn(api, "retentionPolicies").mockResolvedValue(configured);
    vi.spyOn(api, "previewRetention").mockResolvedValue({ ...preview, blocked: [] });
    show();

    // when
    await userEvent.click(await screen.findByTestId("retention-preview"));

    // then
    expect(await screen.findByTestId("retention-blocked-none")).toBeVisible();
    expect(screen.queryByTestId("retention-blocked")).toBeNull();
  });

  it("given a preview, when the board has not confirmed that the run is final, then the run cannot start", async () => {
    // given
    await previewed();
    const running = vi.spyOn(api, "runRetention").mockResolvedValue(run);
    const browserConfirm = vi.spyOn(window, "confirm");

    // when
    await userEvent.click(screen.getByTestId("retention-run"));

    // then
    expect(screen.getByTestId("retention-run"), "the run waits for the acknowledgement").toBeDisabled();
    expect(running).not.toHaveBeenCalled();
    expect(browserConfirm, "the confirmation is part of the form").not.toHaveBeenCalled();
  });

  it("given a confirmed preview, when the run starts, then exactly that preview runs and its figures are shown", async () => {
    // given
    await previewed();
    const running = vi.spyOn(api, "runRetention").mockResolvedValue(run);
    await userEvent.click(screen.getByTestId("retention-acknowledge"));

    // when
    await userEvent.click(screen.getByTestId("retention-run"));

    // then
    expect(await screen.findByTestId("retention-run-result")).toBeVisible();
    expect(running).toHaveBeenCalledExactlyOnceWith(PREVIEW);
    expect(screen.getByTestId("retention-run-formerMembersRemoved")).toHaveTextContent(
      i18n.t("admin.retention.runFigure.formerMembersRemoved", { count: 3 }));
    expect(screen.queryByTestId("retention-preview-result"), "a preview is used up by its run").toBeNull();
  });

  it("given a stale password proof, when the run starts, then the reauthentication dialog asks for it and the same preview runs afterwards", async () => {
    // given
    await previewed();
    const running = vi.spyOn(api, "runRetention").mockRejectedValueOnce(recentAuthenticationRequired).mockResolvedValueOnce(run);
    const reauthenticating = vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
    await userEvent.click(screen.getByTestId("retention-acknowledge"));
    await userEvent.click(screen.getByTestId("retention-run"));
    const password = await screen.findByTestId("retention-reauthentication-password");

    // when
    await userEvent.type(password, "temporary-password");
    await userEvent.click(screen.getByTestId("retention-reauthentication-submit"));

    // then
    expect(await screen.findByTestId("retention-run-result")).toBeVisible();
    expect(reauthenticating).toHaveBeenCalledExactlyOnceWith("temporary-password");
    expect(running.mock.calls).toEqual([[PREVIEW], [PREVIEW]]);
    expect(screen.queryByTestId("retention-reauthentication-password")).toBeNull();
  });

  it("given a dismissed security key proof, when the run is confirmed, then the dialog says the key request was cancelled", async () => {
    // given
    await previewed();
    vi.spyOn(api, "runRetention").mockRejectedValue(recentAuthenticationRequired);
    vi.spyOn(api, "reauthenticate").mockRejectedValue(new SecurityKeyFailure("dismissed", "NotAllowedError"));
    await userEvent.click(screen.getByTestId("retention-acknowledge"));
    await userEvent.click(screen.getByTestId("retention-run"));

    // when
    await userEvent.type(await screen.findByTestId("retention-reauthentication-password"), "current-password");
    await userEvent.click(screen.getByTestId("retention-reauthentication-submit"));

    // then
    expect(await screen.findByTestId("retention-reauthentication-failure")).toHaveTextContent(i18n.t("mfa.keyCancelled"));
  });

  it("given a preview that expired meanwhile, when the run starts, then the refusal is shown and the preview is no longer offered", async () => {
    // given
    await previewed();
    vi.spyOn(api, "runRetention").mockRejectedValue(new ApiError(409, {
      type: "urn:courtside:error:retention-preview-expired", title: "Conflict", status: 409
    }));
    await userEvent.click(screen.getByTestId("retention-acknowledge"));

    // when
    await userEvent.click(screen.getByTestId("retention-run"));

    // then
    expect(await screen.findByTestId("retention-error")).toHaveTextContent(i18n.t("error.type.retention-preview-expired"));
    await waitFor(() => expect(screen.queryByTestId("retention-preview-result")).toBeNull());
  });
  it.each(["escape", "unmount", "account switch"])("given a proof awaiting its response, when %s invalidates its dialog, then never send the saved mutation", async (ending) => {
    // given
    const owner = proofOwnerHarness();
    let proved!: () => void;
    vi.spyOn(api, "reauthenticate").mockReturnValue(new Promise((resolve) => { proved = resolve; }));
    vi.spyOn(api, "retentionPolicies").mockResolvedValue(configured);
    vi.spyOn(api, "previewRetention").mockResolvedValue(preview);
    const changing = vi.spyOn(api, "runRetention").mockRejectedValueOnce(recentAuthenticationRequired).mockResolvedValue(run);
    const shown = show(owner.Wrapper);
    await userEvent.click(await screen.findByTestId("retention-preview"));
    await userEvent.click(await screen.findByTestId("retention-acknowledge"));
    await userEvent.click(screen.getByTestId("retention-run"));
    await userEvent.type(await screen.findByTestId("retention-reauthentication-password"), "current-password");
    await userEvent.click(screen.getByTestId("retention-reauthentication-submit"));
    // when
    if (ending === "escape") {
      await userEvent.click(screen.getByRole("dialog").querySelector("input")!);
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
    }
    else if (ending === "unmount") shown.unmount();
    else act(owner.change);
    await act(async () => { proved(); await Promise.resolve(); });
    // then
    expect(changing).toHaveBeenCalledOnce();
  });

});
