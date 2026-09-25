import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recoverStaleDocument } from "./recoverStaleDocument";

const reload = vi.fn();
const realLocation = window.location;

class FakeWorker extends EventTarget {
  postMessage = vi.fn();
  constructor(public state: string) {
    super();
  }
  become(state: string) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

function serviceWorkers(registration?: { update: () => Promise<void>; waiting: FakeWorker | null;
  installing: FakeWorker | null }) {
  const container = Object.assign(new EventTarget(), {
    getRegistration: vi.fn().mockResolvedValue(registration)
  });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
  return container;
}

describe("recoverStaleDocument", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: Object.assign(new URL(realLocation.href), { reload })
    });
    reload.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("given a newer version waiting, when recovering, then it takes over before the one reload", async () => {
    // given
    const waiting = new FakeWorker("installed");
    const container = serviceWorkers({ update: vi.fn().mockResolvedValue(undefined), waiting, installing: null });

    // when
    await recoverStaleDocument();

    // then
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload, "reloading before the takeover would serve the stale shell again").not.toHaveBeenCalled();

    // when
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));

    // then
    expect(reload).toHaveBeenCalledOnce();
  });

  it("given a newer version still installing, when it finishes, then it is the one that takes over", async () => {
    // given
    const installing = new FakeWorker("installing");
    const update = vi.fn(() => {
      setTimeout(() => installing.become("installed"));
      return Promise.resolve();
    });
    const container = serviceWorkers({ update, waiting: null, installing });

    // when
    await recoverStaleDocument();
    container.dispatchEvent(new Event("controllerchange"));

    // then
    expect(installing.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload).toHaveBeenCalledOnce();
  });

  it("given an installing version that is discarded, when recovering, then the page simply reloads", async () => {
    // given
    const installing = new FakeWorker("installing");
    serviceWorkers({ update: vi.fn().mockResolvedValue(undefined), waiting: null, installing });
    installing.become("redundant");

    // when
    await recoverStaleDocument();

    // then
    expect(installing.postMessage).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("given no newer version, when recovering, then the page simply reloads", async () => {
    // given
    const update = vi.fn().mockRejectedValue(new TypeError("Failed to update"));
    serviceWorkers({ update, waiting: null, installing: null });

    // when
    await recoverStaleDocument();

    // then
    expect(update).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("given a browser without service workers, when recovering, then the page simply reloads", async () => {
    // when
    await recoverStaleDocument();

    // then
    expect(reload).toHaveBeenCalledOnce();
  });

  it("given no registration, when recovering, then the page simply reloads", async () => {
    // given
    serviceWorkers(undefined);

    // when
    await recoverStaleDocument();

    // then
    expect(reload).toHaveBeenCalledOnce();
  });
});
