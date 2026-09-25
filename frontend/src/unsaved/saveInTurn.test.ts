import { expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import i18n from "../i18n";
import { describeFailure, saveInTurn, StepFailed } from "./saveInTurn";

it("given several steps, when all succeed, then each runs once and in order", async () => {
  // given
  const order: string[] = [];

  // when
  await saveInTurn([
    { subject: "Adults", run: async () => { order.push("Adults"); } },
    { subject: "Juniors", run: async () => { order.push("Juniors"); } }
  ]);

  // then
  expect(order).toEqual(["Adults", "Juniors"]);
});

it("given a step that fails, when saving in turn, then the steps after it do not run and the failure names it", async () => {
  // given
  const refused = new ApiError(409);
  const later = vi.fn();

  const juniors = { subject: "Juniors", run: () => Promise.reject(refused) };
  const seniors = { subject: "Seniors", run: later };

  // when
  const failure = await saveInTurn([{ subject: "Adults", run: async () => undefined }, juniors, seniors])
    .catch((thrown: unknown) => thrown);

  // then
  expect(failure).toBeInstanceOf(StepFailed);
  expect((failure as StepFailed).subject).toBe("Juniors");
  expect((failure as StepFailed).cause).toBe(refused);
  expect((failure as StepFailed).remaining, "a retry resumes with the refused step").toEqual([juniors, seniors]);
  expect(later, "nothing is sent after the first refusal").not.toHaveBeenCalled();
});

it("given a failed step, when it is described, then the message names what was not saved and why", async () => {
  // given
  await i18n.changeLanguage("en");

  // when
  const message = describeFailure(new StepFailed("Juniors", new Error("offline")), i18n.t);

  // then
  expect(message).toBe("Juniors was not saved. That did not work. Please try again.");
});
