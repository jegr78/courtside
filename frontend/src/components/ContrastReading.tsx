import { useTranslation } from "react-i18next";
import type { BrandContrast } from "../brandColor";
import { noticeColours } from "./noticeTones";

const READABLE = 4.5;

export function ContrastReading({ contrast, testId }: { contrast: BrandContrast; testId: string }) {
  const { t } = useTranslation();
  const readable = contrast.ratio >= READABLE;
  return <output data-testid={testId} className={`rounded-lg border p-3 text-sm ${noticeColours(readable ? "info" : "warning")}`}>
    {t("admin.config.colorContrast", {
      ratio: contrast.ratio.toFixed(2),
      tone: t(contrast.tone === "dark" ? "admin.config.colorDarkText" : "admin.config.colorLightText"),
      result: t(readable ? "admin.config.colorContrastPass" : "admin.config.colorContrastWarning")
    })}
  </output>;
}
