import type { StatisticsFormat } from "./format";

export type ChangeKind = "count" | "duration" | "ratio";

export interface Change {
  direction: "up" | "down" | "none";
  value?: string;
}

export function changeOf(kind: ChangeKind, current: number | null, previous: number | null | undefined,
  format: StatisticsFormat): Change | undefined {
  if (current === null || previous === null || previous === undefined) return undefined;
  if (kind === "ratio") {
    const points = Math.round((current - previous) * 1000) / 10;
    if (points === 0) return { direction: "none" };
    return { direction: points > 0 ? "up" : "down", value: format.signedPoints(points) };
  }
  const difference = current - previous;
  if (difference === 0) return { direction: "none" };
  const direction = difference > 0 ? "up" : "down";
  if (previous > 0) return { direction, value: format.signedPercent(difference / previous) };
  return { direction, value: kind === "duration" ? format.signedDuration(difference) : format.signedCount(difference) };
}
