import { useTranslation } from "react-i18next";
import { IMPORT_STEPS, type ImportStep } from "./steps";

export function ImportProgress({ current, reached, goTo }: {
  current: ImportStep;
  reached: ImportStep[];
  goTo: (step: ImportStep) => void;
}) {
  const { t } = useTranslation();

  return <nav aria-label={t("admin.import.progress")} data-testid="import-progress">
    <ol className="flex flex-wrap gap-2">
      {IMPORT_STEPS.map((step, index) => {
        const here = step === current;
        return <li key={step}>
          <button
            type="button"
            data-testid={`import-step-${step}`}
            aria-current={here ? "step" : undefined}
            disabled={!here && !reached.includes(step)}
            onClick={() => goTo(step)}
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-left disabled:opacity-50 ${here ? "surface-panel font-bold" : "surface-subtle"}`}
          >
            <span aria-hidden="true" className="tabular-nums">{index + 1}</span>
            <span>{t(`admin.import.step.${step}`)}</span>
          </button>
        </li>;
      })}
    </ol>
  </nav>;
}
