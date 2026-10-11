import { hh, hourOf, weekdayOf, windowDays } from "./calendar.mjs";

export const MEMBER_JOURNEYS = ["singles", "doubles", "guest", "participant", "rebook", "contention"];
export const ROLE_JOURNEYS = ["closure-over-booking", "trainer", "trainer-move", "youth", "youth-move", "league-1", "league-2", "grounds-closure"];
export const PROFILE_NAMES = ["desktop-chrome", "desktop-firefox", "desktop-safari", "ipad", "iphone-se", "iphone-15-de", "iphone-15-en", "iphone-15-landscape", "pixel-7", "narrow"];
const MEMBER_PROFILES = ["desktop-chrome", "desktop-firefox", "pixel-7", "iphone-se", "iphone-15-de", "iphone-15-en", "iphone-15-landscape", "narrow"];
const ROLE_PROFILES = ["desktop-chrome", "desktop-firefox", "desktop-safari", "ipad", "pixel-7"];
const OFFLINE_PROFILES = ["desktop-chrome", "pixel-7"];
const WEEKEND_PROFILES = ["desktop-chrome", "desktop-firefox", "desktop-safari", "ipad", "pixel-7"];
const WEEKDAY_PAIRS = [["desktop-chrome", "desktop-firefox"], ["iphone-15-landscape", "desktop-safari"], ["pixel-7", "ipad"], ["narrow", "iphone-se"], ["iphone-15-de", "iphone-15-en"]];

export class LaneError extends Error {}

export const journeysOf = (profile) => [
  ...(MEMBER_PROFILES.includes(profile) ? MEMBER_JOURNEYS : []),
  ...(ROLE_PROFILES.includes(profile) ? ROLE_JOURNEYS : []),
  ...(OFFLINE_PROFILES.includes(profile) ? ["offline"] : [])
];

export function governingHours(grid, date) {
  const weekday = weekdayOf(date);
  const week = grid.openingWeeks.filter((candidate) => candidate.effectiveFrom === null || candidate.effectiveFrom <= date).at(-1);
  const day = week?.days.find((candidate) => candidate.dayOfWeek === weekday);
  return { opensAt: day?.opensAt ?? null, closesAt: day?.closesAt ?? null };
}

const firstHour = (hoursOf, date) => {
  const { opensAt, closesAt } = hoursOf(date);
  if (!opensAt || !closesAt) throw new LaneError(`lane day ${date} is closed`);
  return { first: hourOf(opensAt), last: Number(closesAt.slice(0, 2)) };
};

export function planLanes({ start, courts, hoursOf }) {
  const days = windowDays(start);
  const slots = [];
  WEEKDAY_PAIRS.forEach((pair, position) => {
    const date = days[position];
    const { first, last } = firstHour(hoursOf, date);
    pair.forEach((profile, side) => {
      const journeys = journeysOf(profile);
      if (first + journeys.length > last) {
        throw new LaneError(`${profile} needs ${journeys.length} hours on ${date} from ${hh(first)}, the club closes at ${hh(last)}`);
      }
      journeys.forEach((journey, index) => slots.push({ profile, journey, date, court: courts[side], start: hh(first + index), end: hh(first + index + 1) }));
    });
  });
  const saturday = days[5];
  const { first, last } = firstHour(hoursOf, saturday);
  WEEKEND_PROFILES.forEach((profile, index) => {
    const hour = first + Math.floor(index / courts.length);
    if (hour + 2 > last) throw new LaneError(`${profile} needs a Saturday hour and a later opening on ${saturday}, the club closes at ${hh(last)}`);
    slots.push({ profile, journey: "saturday-opening", date: saturday, court: courts[index % courts.length], start: hh(hour), end: hh(hour + 1) });
  });
  return { days, saturday, sunday: days[6], slots };
}

export function slotIn(plan, profile, journey) {
  const slot = plan.slots.find((candidate) => candidate.profile === profile && candidate.journey === journey);
  if (!slot) throw new LaneError(`${journey} does not run on ${profile}`);
  return slot;
}
