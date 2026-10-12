import { describe, expect, it } from "vitest";
import { holdsWaitingUpdate } from "./waitingUpdate";

const worker = {} as ServiceWorker;

describe("holdsWaitingUpdate", () => {
  it("given a waiting worker beside an active one, when asked, then an update waits", () => {
    // given
    const registration = { active: worker, waiting: worker };

    // when
    const waits = holdsWaitingUpdate(registration);

    // then
    expect(waits).toBe(true);
  });

  it("given a first install that has not activated yet, when asked, then no update waits", () => {
    // given
    const registration = { active: null, waiting: worker };

    // when
    const waits = holdsWaitingUpdate(registration);

    // then
    expect(waits, "the first worker passes through the waiting slot on its way to active").toBe(false);
  });

  it("given only an active worker, when asked, then no update waits", () => {
    // given
    const registration = { active: worker, waiting: null };

    // when
    const waits = holdsWaitingUpdate(registration);

    // then
    expect(waits).toBe(false);
  });

  it("given no registration, when asked, then no update waits", () => {
    // when
    const waits = holdsWaitingUpdate(undefined);

    // then
    expect(waits).toBe(false);
  });
});
