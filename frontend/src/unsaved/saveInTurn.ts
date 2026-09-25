import type { TFunction } from "i18next";
import { problemMessage } from "../api/problem-message";

export type SaveStep = { subject: string; run: () => Promise<void> };

export class StepFailed extends Error {
  constructor(readonly subject: string, override readonly cause: unknown) {
    super(`${subject} was not saved`);
  }
}

// Stops at the first refusal, so whatever is still unsaved afterwards is exactly what was not sent.
export async function saveInTurn(steps: SaveStep[]): Promise<void> {
  for (const step of steps) {
    try {
      await step.run();
    } catch (failure) {
      throw new StepFailed(step.subject, failure);
    }
  }
}

export function describeFailure(failure: unknown, t: TFunction): string {
  return failure instanceof StepFailed
    ? t("unsaved.stepFailed", { subject: failure.subject, reason: problemMessage(failure.cause, t) })
    : problemMessage(failure, t);
}
