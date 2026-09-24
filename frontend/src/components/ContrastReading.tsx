import { useTranslation } from "react-i18next";
import type { BrandContrast } from "../brandColor";
import { noticeColours } from "./noticeTones";

const READABLE = 4.5;

export function ContrastReading({ contrast, testId }: { contrast: BrandContrast; testId: string }) {
  const { t, i18n } = useTranslation();
  const readable = contrast.ratio >= READABLE;
  // Rounded down, so a ratio that fails never prints as the threshold it misses.
  const ratio = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Math.floor(contrast.ratio * 100) / 100);
  return <output data-testid={testId} className={`rounded-lg border p-3 text-sm ${noticeColours(readable ? "info" : "warning")}`}>
    {t("colorContrast.reading", {
      ratio,
      tone: t(contrast.tone === "dark" ? "colorContrast.darkText" : "colorContrast.lightText"),
      result: t(readable ? "colorContrast.pass" : "colorContrast.warning")
    })}
  </output>;
}
