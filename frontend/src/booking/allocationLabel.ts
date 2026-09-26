import type { TFunction } from "i18next";
import type { Allocation } from "../api/client";

export function allocationLabel(allocation: Allocation, t: TFunction): string {
  if (allocation.ownBooking && allocation.showGenericOccupancy) {
    return [t("booking.viewer"), ...(allocation.participantLastNames ?? [])].join(", ");
  }
  if (!allocation.showGenericOccupancy) return allocation.cardLabel;
  return allocation.participantCount
    ? t("booking.occupiedWithParticipants", { count: allocation.participantCount })
    : t("booking.occupied");
}
