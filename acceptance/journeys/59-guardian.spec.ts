import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { capture } from "../lib/checks";
import { apiAs, apiAsAgain, type Api } from "../lib/api";
import { lanePlan } from "../lib/lanes";
import { addDays, zonedInstant } from "../config/calendar.mjs";
import { governingHours } from "../config/lanes.mjs";
import { persona } from "../lib/context";
import { openAs, reauthenticateIfAsked } from "../lib/session";
import { step } from "../lib/steps";
import { addPartner, discovery, disposableRecord, projectName } from "../lib/journey";
import { recordCreated } from "../lib/ledger";
import { precondition } from "../lib/precondition";
import { gotoDayBeyondWindow } from "../lib/plan";
import { GUARDIAN_PROFILE as PROFILE, readGuardianships, removeGuardianships } from "../lib/guardianship";
import { answers, confirmationsOf, occupying, relationshipsBetween } from "../lib/core.mjs";

test.beforeEach(() => { test.skip(projectName() !== PROFILE, `the guardian journey runs on ${PROFILE}`); });
test.setTimeout(240_000);

const GRANTED = ["VIEW_BOOKINGS", "BOOK", "CANCEL_BOOKINGS", "READ_MESSAGES"];
type Notice = { id: string; kind: string; readAt?: string | null; booking?: { startsAt: string } };

async function heldBy(api: Api, bookingId: string, view = "UPCOMING") {
  let cursor: string | undefined;
  do {
    const page = await (await api.get(`/api/my/bookings?view=${view}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).json() as { items: { id: string }[]; nextCursor?: string | null };
    if (page.items.some((item) => item.id === bookingId)) return true;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return false;
}

async function problem(answer: { status: () => number; json: () => Promise<unknown> }) {
  const body = await answer.json().catch(() => ({})) as { type?: string; violations?: { code: string; params?: Record<string, string> }[] };
  return { status: answer.status(), type: body.type, violation: body.violations?.[0] };
}

async function openDependant(page: Page, dependantId: string) {
  await page.goto("/my-dependants");
  await expect(page.getByTestId("dependants-view"), "product: the guardian's page opens").toBeVisible();
  const choice = page.getByTestId("dependant-choice");
  if (await choice.isVisible()) await choice.selectOption(dependantId);
}

test("given a member the board lets act for the disposable member, when the guardian books, reads and cancels for them, then the dependant holds the booking, an ungranted action is refused and an ended relationship grants nothing", async ({ browser }) => {
  // given
  const admin = await apiAs("admin");
  const guardianId = discovery.personIds["memberA"] as string;
  const dependantId = disposableRecord(persona("disposable").username).personId;
  precondition(relationshipsBetween(await readGuardianships(admin, dependantId), guardianId, dependantId).length === 0,
    `no relationship runs between memberA and the disposable member of ${PROFILE}; remove it on the person page`);
  const timeZone = lanePlan().timeZone;
  const day = addDays(lanePlan().sunday, 10);
  const courts = await (await admin.get("/api/public/courts")).json() as { id: string; number: number }[];
  const { opensAt } = governingHours(await (await admin.get(`/api/public/booking-grid?from=${day}&to=${day}`)).json(), day);
  precondition(opensAt !== null, `the weekly hours open ${day}`);
  const start = opensAt!.slice(0, 5);
  const startsAt = zonedInstant(day, start, timeZone);
  const occupied = occupying(await (await admin.get(`/api/bookings?date=${day}`)).json(), courts[0].id, startsAt, new Date(startsAt.getTime() + 60 * 60_000));
  precondition(occupied.length === 0, `court ${courts[0].number} is free on ${day} at ${start}, it holds ${occupied.join(", ")}`);

  const board = await openAs(browser, "admin");
  const guardianPage = await openAs(browser, "memberA");
  let relationshipId: string | undefined;
  let bookingId: string | undefined;
  try {
    // when
    relationshipId = await step("admin", "guardian relationship created", async () => {
      await board.goto(`/admin/roster/${dependantId}`);
      await expect(board.getByTestId("person-guardianships"), "product: the person page lists the relationships").toBeVisible();
      await board.getByTestId("add-guardianship").click();
      const form = board.getByRole("dialog");
      await form.getByTestId("guardianship-as-dependant").check();
      await form.getByTestId("guardianship-search").fill(discovery.lastNames["memberA"]);
      await form.locator(`[data-testid="guardianship-match"][data-person-id="${guardianId}"]`).click();
      for (const grant of GRANTED) await form.getByTestId(`guardianship-grant-${grant}`).check();
      const path = `/api/admin/roster/${dependantId}/guardianships`;
      const written = board.waitForResponse(answers("POST", path));
      await form.getByTestId("save-guardianship").click();
      let answer = await written;
      if (answer.status() === 401 || answer.status() === 403) {
        const repeated = board.waitForResponse(answers("POST", path));
        await reauthenticateIfAsked(board);
        answer = await repeated;
      }
      const created = await answer.json().catch(() => ({})) as { id?: string; grants?: string[] };
      expect(answer.status(), `product: the board links the guardian (${JSON.stringify(created)})`).toBe(201);
      recordCreated({ kind: "guardianship", id: created.id!, personId: dependantId, by: "admin", project: projectName() });
      expect([...created.grants!].sort(), "product: the relationship grants what the board ticked").toEqual([...GRANTED].sort());
      await expect(board.getByTestId(`guardianship-${created.id}`), "product: the person page shows the running relationship").toHaveAttribute("data-state", "running");
      await capture(board, "guardianship-created");
      return created.id!;
    });

    await step("memberA", "dependant listed", async () => {
      await guardianPage.goto("/my-bookings");
      await expect(guardianPage.getByTestId("my-dependants-link").or(guardianPage.getByTestId("my-dependants-shortcut")).first(),
        "product: a guardian reaches the dependants from the navigation").toBeVisible();
      await openDependant(guardianPage, dependantId);
      await expect(guardianPage.getByTestId(`dependant-${dependantId}`), "product: the dependant is listed").toBeVisible();
      await expect(guardianPage.getByTestId("dependant-credentials"), "product: an ungranted action is not offered").toHaveCount(0);
      await capture(guardianPage, "dependant-page");
    });

    bookingId = await step("memberA", "book for dependant", async () => {
      await guardianPage.getByTestId("dependant-to-courts").click();
      await gotoDayBeyondWindow(guardianPage, day);
      await guardianPage.locator(`button[data-testid="free-slot"][data-date="${day}"][data-court-number="${courts[0].number}"][data-slot="${start}"]`).click();
      await expect(guardianPage.getByTestId("booking-dialog")).toBeVisible();
      await guardianPage.getByTestId("booking-for").selectOption(dependantId);
      await addPartner(guardianPage, "memberB");
      await capture(guardianPage, "booking-for-dependant");
      const created = guardianPage.waitForResponse(answers("POST", `/api/my/dependants/${dependantId}/bookings`));
      await guardianPage.getByTestId("booking-submit").click();
      const answer = await created;
      const body = await answer.json().catch(() => ({})) as { id?: string };
      if (answer.ok() && body.id) recordCreated({ kind: "booking", id: body.id, by: "disposable", project: projectName(), date: day });
      expect(answer.status(), `product: the guardian books for the dependant (${JSON.stringify(body)})`).toBe(201);
      await expect(guardianPage.getByTestId("booking-dialog"), "product: the dialog closes after an accepted booking").not.toBeVisible();
      return body.id!;
    });

    // then
    const dependant = await apiAsAgain("disposable");
    expect(await heldBy(dependant, bookingId), "product: the dependant's own bookings hold the booking").toBe(true);
    expect(await heldBy(await apiAs("memberA"), bookingId), "product: the guardian does not hold the booking").toBe(false);

    await step("memberA", "dependant booking and message", async () => {
      await openDependant(guardianPage, dependantId);
      await expect(guardianPage.getByTestId("dependant-booking-list").getByTestId(`booking-${bookingId}`),
        "product: the guardian sees the dependant's booking").toBeVisible();
      let confirmation: Notice | undefined;
      await expect.poll(async () => {
        const items = (await (await (await apiAs("memberA")).get(`/api/my/dependants/${dependantId}/notifications`)).json()).items as Notice[];
        confirmation = confirmationsOf(items, startsAt)[0];
        return confirmation?.id;
      }, { message: "product: the guardian reads the dependant's booking confirmation", timeout: 20_000 }).toBeTruthy();
      await guardianPage.reload();
      await openDependant(guardianPage, dependantId);
      await expect(guardianPage.getByTestId("dependant-notifications"), "product: the guardian's page lists the dependant's messages").toBeVisible();
      await capture(guardianPage, "dependant-messages");
      const own = (await (await dependant.get("/api/account/notifications?limit=100")).json()).items as Notice[];
      expect(own.find((item) => item.id === confirmation!.id)?.readAt ?? null, "product: the guardian's reading leaves the dependant's message unread").toBeNull();
    });

    await step("memberA", "cancel for dependant", async () => {
      const list = guardianPage.getByTestId("dependant-booking-list");
      await list.locator(`[data-testid="personal-cancel"][data-booking-id="${bookingId}"]`).click();
      const cancelled = guardianPage.waitForResponse(answers("DELETE", `/api/my/dependants/${dependantId}/bookings/${bookingId}`));
      await guardianPage.getByTestId("confirm-cancellation").click();
      expect((await cancelled).status(), "product: the guardian cancels the dependant's booking").toBeLessThan(300);
      await expect(guardianPage.getByTestId("dependant-cancelled"), "product: the page confirms the cancellation").toBeVisible();
      await expect(list.getByTestId(`booking-${bookingId}`), "product: the cancelled booking leaves the guardian's list").toHaveCount(0);
      await capture(guardianPage, "dependant-booking-cancelled");
    });
    expect(await heldBy(dependant, bookingId), "product: the cancelled booking leaves the dependant's upcoming bookings").toBe(false);
    expect(await heldBy(dependant, bookingId, "CANCELLED"), "product: the dependant reads the booking as cancelled").toBe(true);

    const refused = await problem(await (await apiAs("memberA")).post(`/api/my/dependants/${dependantId}/credentials`, {}));
    expect(refused.status, "product: a guardian without account tasks cannot ask for credentials").toBe(403);
    expect(refused.type, "product: the refusal names the missing grant").toBe("urn:courtside:error:guardian-action-not-granted");
    expect(refused.violation, "product: the refusal carries the action").toEqual({ code: "guardianship.actionNotGranted", params: { action: "ACCOUNT_TASKS" } });

    await step("admin", "guardian relationship ended", async () => {
      await board.reload();
      await board.getByTestId(`end-guardianship-${relationshipId}`).click();
      const path = `/api/admin/roster/${dependantId}/guardianships/${relationshipId}/end`;
      const ended = board.waitForResponse(answers("POST", path));
      await board.getByTestId("confirm-end-guardianship").click();
      let answer = await ended;
      if (answer.status() === 401 || answer.status() === 403) {
        const repeated = board.waitForResponse(answers("POST", path));
        await reauthenticateIfAsked(board);
        answer = await repeated;
      }
      expect(answer.status(), "product: the board ends the relationship today").toBeLessThan(300);
      await expect(board.getByTestId(`guardianship-${relationshipId}`), "product: the relationship reads ended").toHaveAttribute("data-state", "ended");
      await capture(board, "guardianship-ended");
    });

    const gone = await problem(await (await apiAs("memberA")).get(`/api/my/dependants/${dependantId}/bookings`));
    expect(gone.status, "product: an ended relationship lets the guardian see nothing").toBe(404);
    expect(gone.type, "product: the refusal says only that the person is not a dependant").toBe("urn:courtside:error:dependant-not-found");
    await step("memberA", "dependant gone", async () => {
      await openDependant(guardianPage, dependantId);
      await expect(guardianPage.getByTestId(`dependant-${dependantId}`), "product: the page no longer lists the dependant").toHaveCount(0);
      await capture(guardianPage, "dependant-gone");
    });
  } finally {
    await board.context().close();
    await guardianPage.context().close();
    if (bookingId) await admin.del(`/api/bookings/${bookingId}`);
    const removed = await removeGuardianships(admin);
    expect(removed.filter((outcome) => outcome.status >= 300 && outcome.status !== 404), "every relationship of the run is removed").toEqual([]);
    const left = (await readGuardianships(admin, dependantId)).map((relationship) => relationship.id).filter((id) => removed.some((outcome) => outcome.id === id));
    expect(left, "no relationship of the run is left").toEqual([]);
  }
});
