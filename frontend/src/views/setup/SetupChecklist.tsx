import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { noticeColours } from "../../components/noticeTones";
import { REQUIRED_STEPS, type SetupStep } from "./useSetupSteps";

export function SetupProgress({ completed }: { completed: number }) {
  const { t } = useTranslation();
  return <div className="grid gap-2">
    <p data-testid="setup-progress" className="font-semibold" aria-live="polite">
      {t("admin.setup.progress", { completed, total: REQUIRED_STEPS })}
    </p>
    <div role="progressbar" data-testid="setup-progress-bar" aria-label={t("admin.setup.progressLabel")}
         aria-valuemin={0} aria-valuemax={REQUIRED_STEPS} aria-valuenow={completed}
         className="h-2 w-full overflow-hidden rounded-full border border-(--cs-border) bg-(--cs-raised)">
      <div data-testid="setup-progress-fill" className="h-full bg-(--club-primary) forced-colors:bg-[CanvasText]"
           style={{ width: `${(completed / REQUIRED_STEPS) * 100}%` }} />
    </div>
  </div>;
}

export function SetupSteps({ steps, headingLevel = 2 }: { steps: SetupStep[]; headingLevel?: 2 | 3 }) {
  return <ol className="grid gap-4">
    {steps.map((step) => <SetupStepCard key={step.id} step={step} headingLevel={headingLevel} />)}
  </ol>;
}

type StepState = "complete" | "next" | "optional" | "available";

// The symbol and the border keep the states apart where forced colours flatten every tone.
const STEP_MARKS: Record<StepState, { symbol: string; look: string }> = {
  complete: { symbol: "✓", look: `border ${noticeColours("success")}` },
  next: { symbol: "→", look: `border-2 ${noticeColours("warning")}` },
  optional: { symbol: "○", look: "text-muted border border-dashed" },
  available: { symbol: "✓", look: `border ${noticeColours("info")}` }
};

function stepState(step: SetupStep): StepState {
  if (step.optional) return step.complete ? "available" : "optional";
  return step.complete ? "complete" : "next";
}

function SetupStepCard({ step, headingLevel }: { step: SetupStep; headingLevel: 2 | 3 }) {
  const { t } = useTranslation();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const state = stepState(step);
  const mark = STEP_MARKS[state];
  return <li data-testid={`setup-step-${step.id === "membershipTypes" ? "membership-types" : step.id}`} data-state={state}
    className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_auto] sm:items-center">
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Heading className="text-xl font-bold">{t(`admin.setup.${step.id}.title`)}</Heading>
        <span data-testid="setup-state-badge" data-state={state}
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold ${mark.look}`}>
          <span data-testid="setup-state-mark" aria-hidden="true">{mark.symbol}</span>
          {t(`admin.setup.state.${state}`)}
        </span>
      </div>
      <p className="text-muted">{t(`admin.setup.${step.id}.description`)}</p>
    </div>
    <Link className="font-semibold underline" to={step.to}>{t(`admin.setup.${step.id}.action`)}</Link>
  </li>;
}
