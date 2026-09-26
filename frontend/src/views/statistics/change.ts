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
  if (previous > 0) {
    const ratio = Math.round(difference / previous * 1000) / 1000;
    if (ratio === 0) return { direction: "none" };
    return { direction: ratio > 0 ? "up" : "down", value: format.signedPercent(ratio) };
  }
  if (difference === 0) return { direction: "none" };
  const direction = difference > 0 ? "up" : "down";
  return { direction, value: kind === "duration" ? format.signedDuration(difference) : format.signedCount(difference) };
}
