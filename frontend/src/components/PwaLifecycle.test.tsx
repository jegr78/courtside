import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { PwaLifecycle } from "./PwaLifecycle";

const { registerSW } = vi.hoisted(() => ({ registerSW: vi.fn() }));

vi.mock("virtual:pwa-register", () => ({ registerSW }));

const worker = {} as ServiceWorker;

type RejectionListener = (reason: unknown) => void;
const { process: runtime } = globalThis as unknown as {
  process: { on(event: "unhandledRejection", listener: RejectionListener): void; off(event: "unhandledRejection", listener: RejectionListener): void };
};

function registrationHolds(registration: { active: ServiceWorker | null; waiting: ServiceWorker | null }) {
  const getRegistration = vi.fn().mockResolvedValue(registration);
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration } });
  return getRegistration;
}

describe("PwaLifecycle", () => {
  beforeEach(() => registerSW.mockReset());

  it("given a waiting service worker, when the user reloads, then the prompt describes the browser action and the new version is activated", async () => {
    // given
    registrationHolds({ active: worker, waiting: worker });
    const update = vi.fn().mockResolvedValue(undefined);
    let needRefresh: (() => void) | undefined;
    registerSW.mockImplementation((options?: { onNeedRefresh: () => void }) => {
      needRefresh = options?.onNeedRefresh;
      return update;
    });
    render(<PwaLifecycle />);

    // when
    needRefresh?.();
    const prompt = await screen.findByTestId("pwa-update-prompt");
    const reload = await screen.findByTestId("pwa-update");

    // then
    expect(prompt).toHaveTextContent("Courtside wurde aktualisiert. Lade die Seite neu, um die neue Version zu verwenden.");
    expect(reload).toHaveTextContent("Neu laden");

    // when
    await userEvent.click(reload);

    // then
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(true);
  });

  it("given a first install still in the waiting slot, when workbox reports it as waiting, then no update prompt is shown", async () => {
    // given
    const getRegistration = registrationHolds({ active: null, waiting: worker });
    let needRefresh: (() => void) | undefined;
    registerSW.mockImplementation((options?: { onNeedRefresh: () => void }) => {
      needRefresh = options?.onNeedRefresh;
      return vi.fn();
    });
    render(<PwaLifecycle />);

    // when
    await act(async () => {
      needRefresh?.();
      await Promise.resolve();
    });

    // then
    expect(getRegistration).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("pwa-update-prompt"), "nothing was deployed, so nothing may be offered").not.toBeInTheDocument();
  });

  it("given the registration cannot be read, when workbox reports a waiting worker, then no update prompt is shown and nothing is left unhandled", async () => {
    // given
    const getRegistration = vi.fn().mockRejectedValue(new DOMException("insecure", "SecurityError"));
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration } });
    let needRefresh: (() => void) | undefined;
    registerSW.mockImplementation((options?: { onNeedRefresh: () => void }) => {
      needRefresh = options?.onNeedRefresh;
      return vi.fn();
    });
    const unhandled = vi.fn();
    runtime.on("unhandledRejection", unhandled);
    render(<PwaLifecycle />);

    // when
    try {
      await act(async () => {
        needRefresh?.();
        await new Promise((settled) => setTimeout(settled, 0));
      });
    } finally {
      runtime.off("unhandledRejection", unhandled);
    }

    // then
    expect(getRegistration).toHaveBeenCalledOnce();
    expect(unhandled, "a registration that cannot be read is no reason to fail").not.toHaveBeenCalled();
    expect(screen.queryByTestId("pwa-update-prompt")).not.toBeInTheDocument();
  });

  it("given no waiting update, when the component loads, then no update prompt is shown", () => {
    // given
    registerSW.mockReturnValue(vi.fn());

    // when
    render(<PwaLifecycle />);

    // then
    expect(screen.queryByTestId("pwa-update")).not.toBeInTheDocument();
  });

  it("given service-worker registration fails, when the callback reports it, then the limitation is visible", async () => {
    // given
    let registrationFailed: (() => void) | undefined;
    registerSW.mockImplementation((options?: { onRegisterError: () => void }) => {
      registrationFailed = options?.onRegisterError;
      return vi.fn();
    });
    render(<PwaLifecycle />);

    // when
    registrationFailed?.();

    // then
    const warning = await screen.findByTestId("pwa-registration-warning");
    expect(warning.querySelector("[role='status']"), "a degraded capability is a caution, the app still works").not.toBeNull();
    expect(warning.querySelector("[role='alert']")).toBeNull();
    expect(warning).toHaveTextContent("Offline-Nutzung und automatische Update-Hinweise");
    expect(warning).toHaveTextContent("vertrauenswürdiges HTTPS-Zertifikat");
  });
});
