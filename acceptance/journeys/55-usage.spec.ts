import { test, expect } from "../lib/fixtures";
import { capture } from "../lib/checks";
import { apiAs } from "../lib/api";
import { lanePlan } from "../lib/lanes";
import { localDate } from "../config/calendar.mjs";
import { openAs } from "../lib/session";
import { step } from "../lib/steps";
import { discovery, projectName } from "../lib/journey";
import { disposables, type PersonaKey, persona } from "../lib/context";
import { precondition } from "../lib/precondition";
import { DISPOSABLE_PROFILES } from "../config/disposables.mjs";
import { personaIdentities, usagePeriod } from "../lib/core.mjs";

const PERSONAS: PersonaKey[] = ["admin", "trainer", "youth", "sport", "grounds", "treasurer", "memberA", "memberB", "memberC"];

type Usage = {
  capacity: { uses: { bookings: number }[] };
  cancellations: { cancelled: number };
  attendance: { tracked: boolean; liftedNoShows: number };
  ruleRejections: { attempts: number };
};

test.beforeEach(() => { test.skip(!/desktop/.test(projectName()), "the usage report is a desk page, read on the desktop browsers"); });

test("given a run that booked, refused and lifted a no-show, when the board reads the usage report for the run window, then each part loads in counts and no persona is named", async ({ browser }) => {
  // given
  const period = usagePeriod(localDate(new Date(), lanePlan().timeZone), lanePlan().days);
  const identities = personaIdentities(discovery.roster,
    [...PERSONAS.map((key) => persona(key).username), ...disposables],
    [...Object.values(discovery.emails as Record<string, string | null>),
      ...Object.values(discovery.disposables as Record<string, { email: string | null }>).map((record) => record.email)]);
  precondition(identities.length > 0, "the discovery names the personas of the run");
  const page = await openAs(browser, "admin");
  try {
    // when
    await step("admin", "usage report", async () => {
      await page.goto(`/admin/usage?from=${period.from}&to=${period.to}`);
      for (const part of ["usage-capacity", "usage-cancelled", "usage-no-shows", "usage-refused-attempts"]) {
        await expect(page.getByTestId(part), `product: the ${part} part loads`).toBeVisible();
      }
      await capture(page, "usage");
    });

    // then
    const shown = await page.getByTestId("usage-report").innerText();
    for (const identity of identities) {
      expect(shown.includes(identity), "product: the usage report names no persona and no address").toBe(false);
    }
    const answer = await (await apiAs("admin")).get(`/api/admin/reports/usage?from=${period.from}&to=${period.to}`);
    expect(answer.status(), "product: the usage report answers the run window").toBe(200);
    const raw = await answer.text();
    for (const identifier of [...Object.values(discovery.personIds as Record<string, string>), ...identities]) {
      expect(raw.includes(identifier), "product: the report carries no person id, name or address").toBe(false);
    }
    const usage = JSON.parse(raw) as Usage;
    // A journey's own cancellations may start outside the window or be swept first, so only their shape is certain.
    expect(Number.isInteger(usage.cancellations.cancelled), "product: cancellations are counted").toBe(true);
    if (projectName() !== DISPOSABLE_PROFILES[0]) return;
    // The no-show journey runs on this profile only, in the file before this one, so its traces are in the window.
    expect(usage.ruleRejections.attempts, "product: the probes the no-show journey made are counted as refusals").toBeGreaterThan(0);
    expect(usage.capacity.uses.reduce((sum, use) => sum + use.bookings, 0),
      "product: the booking seeded for the no-show counts towards capacity").toBeGreaterThan(0);
    precondition(usage.attendance.tracked, "the club records attendance (Fristen und Erinnerungen, Anwesenheit erfassen)");
    expect(usage.attendance.liftedNoShows, "product: the no-show the board lifted is counted as lifted").toBeGreaterThan(0);
  } finally {
    await page.context().close();
  }
});
