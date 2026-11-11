import { describe, expect, it, vi } from "vitest";
import { holdsWaitingUpdate, replaceInterface, type UpdatableRegistration } from "./waitingUpdate";

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

class FakeWorker {
  readonly postMessage = vi.fn();
  private readonly listeners: Array<() => void> = [];

  constructor(public state: ServiceWorkerState) {}

  addEventListener(_type: "statechange", listener: () => void) {
    this.listeners.push(listener);
  }

  become(state: ServiceWorkerState) {
    this.state = state;
    this.listeners.splice(0).forEach((listener) => listener());
  }
}

function registrationWith(waiting: FakeWorker | null, installing: FakeWorker | null = null) {
  return {
    waiting, installing,
    update: vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
    unregister: vi.fn<() => Promise<boolean>>().mockResolvedValue(true)
  } satisfies UpdatableRegistration & { waiting: FakeWorker | null; installing: FakeWorker | null };
}

function controllerChanges() {
  const listeners: Array<() => void> = [];
  return {
    container: { addEventListener: (_type: "controllerchange", listener: () => void) => { listeners.push(listener); } },
    change: () => listeners.forEach((listener) => listener())
  };
}

const skipWaiting = { type: "SKIP_WAITING" };
const replacement = { unregisterWithoutWaiting: true };

describe("replaceInterface", () => {
  it("given an older worker waits while a newer one installs, when the interface is replaced, then only the newer worker is confirmed", async () => {
    // given
    const older = new FakeWorker("installed");
    const newer = new FakeWorker("installing");
    const registration = registrationWith(older, newer);
    const { container } = controllerChanges();

    // when
    const replaced = replaceInterface(registration, container, vi.fn(), replacement);
    await Promise.resolve();
    registration.waiting = newer;
    registration.installing = null;
    newer.become("installed");
    older.become("redundant");
    await replaced;

    // then
    expect(newer.postMessage).toHaveBeenCalledWith(skipWaiting);
    expect(older.postMessage, "the waiting worker is no longer the build the server ships").not.toHaveBeenCalled();
  });

  it("given the server ships a build nobody has fetched yet, when the interface is replaced, then the update check runs before anything is confirmed", async () => {
    // given
    const older = new FakeWorker("installed");
    const newer = new FakeWorker("installing");
    const registration = registrationWith(older);
    registration.update.mockImplementation(() => {
      registration.installing = newer;
      return Promise.resolve();
    });

    // when
    const replaced = replaceInterface(registration, controllerChanges().container, vi.fn(), replacement);
    await vi.waitFor(() => expect(registration.installing).toBe(newer));
    await Promise.resolve();
    registration.waiting = newer;
    registration.installing = null;
    newer.become("installed");
    await replaced;

    // then
    expect(newer.postMessage).toHaveBeenCalledWith(skipWaiting);
    expect(older.postMessage).not.toHaveBeenCalled();
  });

  it("given the update check fails offline, when the interface is replaced, then the waiting worker is confirmed", async () => {
    // given
    const waiting = new FakeWorker("installed");
    const registration = registrationWith(waiting);
    registration.update.mockRejectedValue(new TypeError("offline"));

    // when
    await replaceInterface(registration, controllerChanges().container, vi.fn(), replacement);

    // then
    expect(waiting.postMessage).toHaveBeenCalledWith(skipWaiting);
  });

  it("given the newer worker fails to install, when the interface is replaced, then the waiting worker is still confirmed", async () => {
    // given
    const waiting = new FakeWorker("installed");
    const failing = new FakeWorker("installing");
    const registration = registrationWith(waiting, failing);

    // when
    const replaced = replaceInterface(registration, controllerChanges().container, vi.fn(), replacement);
    await Promise.resolve();
    registration.installing = null;
    failing.become("redundant");
    await replaced;

    // then
    expect(waiting.postMessage, "a failed precache must not leave the button waiting forever").toHaveBeenCalledWith(skipWaiting);
  });

  it("given the update check never answers, when the time runs out, then the waiting worker is confirmed", async () => {
    // given
    vi.useFakeTimers();
    try {
      const waiting = new FakeWorker("installed");
      const registration = registrationWith(waiting);
      registration.update.mockReturnValue(new Promise(() => undefined));

      // when
      const replaced = replaceInterface(registration, controllerChanges().container, vi.fn(), replacement);
      await vi.advanceTimersByTimeAsync(30_000);
      await replaced;

      // then
      expect(waiting.postMessage).toHaveBeenCalledWith(skipWaiting);
    } finally {
      vi.useRealTimers();
    }
  });

  it("given a confirmed worker, when it takes control, then the page reloads and not before", async () => {
    // given
    const waiting = new FakeWorker("installed");
    const { container, change } = controllerChanges();
    const reload = vi.fn();

    // when
    await replaceInterface(registrationWith(waiting), container, reload, replacement);

    // then
    expect(reload, "the old worker would answer an early reload with the old shell").not.toHaveBeenCalled();

    // when
    change();

    // then
    expect(reload).toHaveBeenCalledOnce();
  });

  it("given no worker waits, when the interface is replaced, then the worker is unregistered before the page reloads", async () => {
    // given
    const registration = registrationWith(null);
    const order: string[] = [];
    registration.unregister.mockImplementation(() => {
      order.push("unregister");
      return Promise.resolve(true);
    });

    // when
    await replaceInterface(registration, controllerChanges().container, () => order.push("reload"), replacement);

    // then
    expect(order, "the controlling worker would answer a plain reload with the same shell").toEqual(["unregister", "reload"]);
  });

  it("given no worker waits and the app must still start offline, when the interface is replaced, then the worker stays registered", async () => {
    // given
    const registration = registrationWith(null);
    const reload = vi.fn();

    // when
    await replaceInterface(registration, controllerChanges().container, reload, { unregisterWithoutWaiting: false });

    // then
    expect(registration.unregister).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("given no registration, when the interface is replaced, then the page reloads", async () => {
    // given
    const reload = vi.fn();

    // when
    await replaceInterface(undefined, controllerChanges().container, reload, replacement);

    // then
    expect(reload).toHaveBeenCalledOnce();
  });
});
