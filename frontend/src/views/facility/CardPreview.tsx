import { useTranslation } from "react-i18next";
import { contrastColor } from "../cardColors";

export function CardPreview({ label, color, showGenericOccupancy }: { label: string; color: string; showGenericOccupancy: boolean }) {
  const { t } = useTranslation();
  return <section className="grid gap-2">
    <h2 className="font-medium">{t("admin.facility.preview")}</h2>
    <div
      data-testid="card-preview"
      data-card-color={color}
      data-state={showGenericOccupancy ? "occupied" : "card"}
      className="w-full max-w-64 rounded-md px-3 py-2 text-left font-semibold"
      style={{ backgroundColor: color, color: contrastColor(color) }}
    >{showGenericOccupancy ? t("booking.occupied") : label}</div>
  </section>;
}
