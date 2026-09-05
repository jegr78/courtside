import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button";
import { IMPORT_STEPS, type ImportStep } from "./steps";

export function ImportProgress({ current, reached, goTo }: {
  current: ImportStep;
  reached: ImportStep[];
  goTo: (step: ImportStep) => void;
}) {
  const { t } = useTranslation();

  return <nav aria-label={t("admin.import.progress")} data-testid="import-progress">
    <ol className="flex flex-wrap gap-3">
      {IMPORT_STEPS.map((step, index) => {
        const here = step === current;
        return <li key={step}>
          <Button
            variant="secondary"
            type="button"
            data-testid={`import-step-${step}`}
            aria-current={here ? "step" : undefined}
            disabled={!here && !reached.includes(step)}
            onClick={() => goTo(step)}
            className={`flex items-center gap-2 rounded-full ${here ? "ring-2 ring-(--club-primary)" : ""}`}
          >
            <span aria-hidden="true" className="tabular-nums">{index + 1}</span>
            <span>{t(`admin.import.step.${step}`)}</span>
          </Button>
        </li>;
      })}
    </ol>
  </nav>;
}
