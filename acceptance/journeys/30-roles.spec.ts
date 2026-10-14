import { runPath } from "../lib/context";
import { type Page } from "@playwright/test";
import { test, expect } from "../lib/fixtures";
import { appendFileSync } from "node:fs";
import { capture } from "../lib/checks";
import { recordCreated } from "../lib/ledger";
import { openAs, xsrf } from "../lib/session";
import { step } from "../lib/steps";
import { addPartner, bookAt, cancelQuietly, discovery, onDesksAndTablet, projectName } from "../lib/journey";
import type { PersonaKey } from "../lib/context";
import { answers } from "../lib/core.mjs";

test.beforeEach(() => { test.skip(!onDesksAndTablet(), "role journeys run on desks, tablet and one phone"); });

async function openAppointments(page: Page) {
  await page.getByTestId("administration-link").click();
  await expect(page.getByTestId("managed-appointments-page")).toBeVisible();
}

async function createSeries(page: Page, who: PersonaKey, card: string, courtValue: string | number, date: string, weekday: string, time: string, sink: { seriesId?: string; bookingIds?: string[] } = {}) {
  await page.getByTestId("new-series").click();
  await expect(page.getByTestId("series-form")).toBeVisible();
  await capture(page, "series-form");
  if (typeof courtValue === "number") await page.getByTestId("series-courts").selectOption({ index: courtValue });
  else await page.getByTestId("series-courts").selectOption(courtValue);
  await page.getByTestId("series-card").selectOption(card);
  await page.getByTestId("series-starts-on").fill(date);
  await page.getByTestId("series-start-time").fill(time);
  await page.getByTestId(`series-weekday-${weekday}`).click();
  await page.getByTestId("series-occurrence-count").fill("1");
  await page.getByTestId("preview-series").click();
  await expect(page.getByTestId("series-occurrence-0").or(page.getByTestId("series-skipped"))).toBeVisible();
  await capture(page, "series-preview");
  const created = page.waitForResponse(answers("POST", "/api/booking-series"));
  await page.getByTestId("confirm-series").click();
  const response = await created;
  const body = await response.json();
  Object.assign(sink, body);
  if (response.ok() && body.seriesId) recordCreated({ kind: "series", id: body.seriesId, anchor: body.bookingIds[0], by: who, project: projectName() });
  for (const id of body.bookingIds ?? []) recordCreated({ kind: "booking", id, by: who, project: projectName() });
  return { status: response.status(), body };
}

async function cancelSeries(page: Page, seriesId: string, anchor: string) {
  try {
    await page.request.delete(`/api/booking-series/${seriesId}?scope=WHOLE_SERIES&fromBookingId=${anchor}`, { headers: { "X-XSRF-TOKEN": await xsrf(page) } });
  } catch { /* the ledger replay cancels what a closed context could not */ }
}

async function recordSurfaces(page: Page, key: PersonaKey) {
  const links = await page.locator('[data-testid^="admin-"][data-testid$="-link"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  appendFileSync(runPath("role-surfaces.jsonl"), JSON.stringify({ project: projectName(), key, links: [...new Set(links)] }) + "\n");
}

async function revealBooking(page: Page, id: string) {
  const booking = page.getByTestId(`booking-${id}`);
  const more = page.getByTestId("managed-load-more");
  const loaded = async () => { await expect(page.getByTestId("managed-bookings")).toBeVisible(); await expect(page.locator('[data-testid="managed-appointments-page"] p[role="status"]')).toHaveCount(0); };
  await loaded();
  for (let pageNo = 0; pageNo < 10 && await booking.count() === 0 && await more.isVisible(); pageNo++) {
    appendFileSync(runPath("observations.jsonl"), JSON.stringify({ project: projectName(), test: test.info().title, note: "managed appointment only reachable after load-more", id }) + "\n");
    await expect(more).toBeEnabled();
    await more.click();
    await expect(async () => { if (await more.isVisible()) expect(await more.isEnabled()).toBe(true); }).toPass();
  }
  await expect(booking).toBeAttached();
  const summary = booking.locator("xpath=ancestor::details/summary");
  if (await summary.count() > 0 && !(await booking.isVisible())) await summary.click();
  await expect(booking).toBeVisible();
  return booking;
}

for (const key of ["trainer", "youth"] as const) {
  test(`given the ${key}, when a training appointment is arranged, moved and called off, then each step is confirmed`, async ({ browser, lanes }) => {
    // given
    const card = discovery.cardFor.training;
    const slot = await lanes.take(key);
    const target = await lanes.take(key === "trainer" ? "trainer-move" : "youth-move");
    const weekday = new Date(`${slot.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }).toUpperCase();
    const page = await openAs(browser, key);
    let created: { seriesId?: string; bookingIds?: string[] } = {};
    try {
      await step(key, "appointments", async () => { await openAppointments(page); await capture(page, "appointments"); await recordSurfaces(page, key); });
      const courts = await (await page.request.get("/api/public/courts")).json() as { id: string; number: number }[];
      // when
      const result = await step(key, "create series", () => createSeries(page, key, card, courts.find((c) => c.number === slot.court)!.id, slot.date, weekday, slot.start, created));
      created = result.body;
      // then
      expect(result.status, `product: the series is created (${JSON.stringify(result.body)})`).toBeLessThan(300);
      expect(created.bookingIds, "product: one occurrence created").toHaveLength(1);
      await expect(page.getByTestId("series-created"), "product: the series is confirmed").toBeVisible();
      await capture(page, "series-created");
      const id = created.bookingIds![0];
      // when / then — the occurrence moves, then is called off
      await step(key, "move", async () => {
        const booking = await revealBooking(page, id);
        await booking.getByTestId("managed-actions").click();
        await capture(page, "managed-actions");
        await booking.getByTestId("move-booking").click();
        await expect(page.getByTestId("move-dialog")).toBeVisible();
        await page.getByTestId("move-start-time").fill(target.start);
        await page.getByTestId("preview-move").click();
        await capture(page, "move-preview");
        const moved = page.waitForResponse(answers("POST", /\/move$/));
        await page.getByTestId("confirm-move").click();
        const answer = await moved;
        expect(answer.status(), `product: the move is accepted (${await answer.text()})`).toBeLessThan(300);
        await expect(page.getByTestId("move-dialog"), "product: the move dialog closes").not.toBeVisible();
      });
      await step(key, "call off", async () => {
        const booking = await revealBooking(page, id);
        await booking.getByTestId("managed-actions").click();
        await booking.getByTestId("managed-cancel").click();
        await page.getByTestId("scope-WHOLE_SERIES").click();
        await capture(page, "cancel-series");
        await page.getByTestId("confirm-cancellation").click();
        await expect(page.getByTestId(`booking-${created.bookingIds![0]}`), "product: the called-off appointment leaves the list").toHaveCount(0);
        await capture(page, "after-cancel");
      });
    } finally {
      if (created.seriesId && created.bookingIds?.[0]) await cancelSeries(page, created.seriesId, created.bookingIds[0]);
      await page.context().close();
    }
  });
}

test("given the sport director, when two league matches are booked, then both appear among the managed appointments", async ({ browser, lanes }) => {
  // given
  const card = discovery.cardFor.league;
  const page = await openAs(browser, "sport");
  const ids: string[] = [];
  try {
    // when
    for (const journey of ["league-1", "league-2"] as const) {
      const slot = await lanes.take(journey);
      ids.push(await step("sport", journey, () => bookAt(page, "sport", slot, async () => {}, { card })));
    }
    // then
    await step("sport", "managed appointments", async () => {
      await openAppointments(page);
      await recordSurfaces(page, "sport");
      for (const id of ids) await expect(page.getByTestId(`booking-${id}`), "product: the league match is a managed appointment").toBeAttached();
      await capture(page, "appointments-with-league");
    });
  } finally { await cancelQuietly(page, ids); await page.context().close(); }
});

test("given the groundskeeper, when a free court is closed from the plan, then the closure is a managed appointment", async ({ browser, lanes }) => {
  // given
  const page = await openAs(browser, "grounds");
  const ids: string[] = [];
  try {
    const slot = await lanes.take("grounds-closure");
    // when
    ids.push(await step("grounds", "close from plan", () => bookAt(page, "grounds", slot, async () => {}, { card: discovery.cardFor.closure })));
    // then
    await step("grounds", "plan with closure", () => capture(page, "plan-with-closure"));
    await step("grounds", "appointments", async () => {
      await openAppointments(page);
      await recordSurfaces(page, "grounds");
      await expect(page.getByTestId(`booking-${ids[0]}`), "product: the closure is a managed appointment").toBeAttached();
      await capture(page, "appointments-with-closure");
    });
  } finally { await cancelQuietly(page, ids); await page.context().close(); }
});

test("given a member booking, when the groundskeeper plans a closure over it, then the preview refuses that occurrence", async ({ browser, lanes }) => {
  // given
  const member = await openAs(browser, "memberA");
  const grounds = await openAs(browser, "grounds");
  const ids: string[] = [];
  try {
    const slot = await lanes.take("closure-over-booking");
    const [date, court, period] = [slot.date, String(slot.court), slot.start];
    ids.push(await bookAt(member, "memberA", slot, (p) => addPartner(p, "memberB")));
    const courts = await (await grounds.request.get("/api/public/courts")).json();
    const courtId = courts.find((c: { number: number }) => String(c.number) === court).id;
    const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }).toUpperCase();
    // when
    await openAppointments(grounds);
    await grounds.getByTestId("new-series").click();
    await grounds.getByTestId("series-courts").selectOption(courtId);
    await grounds.getByTestId("series-card").selectOption(discovery.cardFor.closure);
    await grounds.getByTestId("series-starts-on").fill(date!);
    await grounds.getByTestId("series-start-time").fill(period!);
    await grounds.getByTestId(`series-weekday-${weekday}`).click();
    await grounds.getByTestId("series-occurrence-count").fill("1");
    await grounds.getByTestId("preview-series").click();
    // then
    await expect(grounds.getByTestId("series-creatable-count")).toBeVisible();
    await capture(grounds, "closure-over-booking-preview");
    await expect(grounds.getByTestId("confirm-series"), "product: a closure over a member booking cannot be confirmed").toBeDisabled();
  } finally {
    await cancelQuietly(member, ids);
    await member.context().close(); await grounds.context().close();
  }
});

test("given the treasurer, when the administration area is opened, then what the role sees is recorded", async ({ browser }) => {
  // given
  const page = await openAs(browser, "treasurer");
  try {
    // when / then — what the role sees is captured and recorded
    const link = page.getByTestId("administration-link");
    if (await link.isVisible()) {
      await link.click();
      await page.waitForLoadState("networkidle");
      await capture(page, "administration");
    }
    await recordSurfaces(page, "treasurer");
  } finally { await page.context().close(); }
});
