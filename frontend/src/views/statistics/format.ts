import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export function hoursAndMinutes(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const magnitude = Math.abs(minutes);
  return `${sign}${Math.floor(magnitude / 60)}:${String(magnitude % 60).padStart(2, "0")}`;
}

export interface StatisticsFormat {
  language: string;
  count: (value: number) => string;
  percent: (ratio: number) => string;
  duration: (minutes: number) => string;
  signedCount: (value: number) => string;
  signedPercent: (ratio: number) => string;
  signedPoints: (points: number) => string;
  signedDuration: (minutes: number) => string;
}

export function useStatisticsFormat(): StatisticsFormat {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  return useMemo(() => {
    const count = new Intl.NumberFormat(language, { maximumFractionDigits: 0 });
    const percent = new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 });
    const signedCount = new Intl.NumberFormat(language, { maximumFractionDigits: 0, signDisplay: "exceptZero" });
    const signedPercent = new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
    const signedPoints = new Intl.NumberFormat(language, { maximumFractionDigits: 1, signDisplay: "exceptZero" });
    return {
      language,
      count: (value) => count.format(value),
      percent: (ratio) => percent.format(ratio),
      duration: hoursAndMinutes,
      signedCount: (value) => signedCount.format(value),
      signedPercent: (ratio) => signedPercent.format(ratio),
      signedPoints: (points) => signedPoints.format(points),
      signedDuration: (minutes) => `${minutes > 0 ? "+" : ""}${hoursAndMinutes(minutes)}`
    };
  }, [language]);
}
