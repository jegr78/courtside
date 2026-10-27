import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { proofOwnerHarness } from "../test/ProofOwner";
import { AdminMfaRecovery } from "./AdminMfaRecovery";

afterEach(() => { vi.restoreAllMocks(); document.cookie = "XSRF-TOKEN=; Max-Age=0"; });

it.each([false, true])("given actor replacement is %s, when the real rescue client receives an unauthorized response, then notify only the actor that sent it", async (changed) => {
  // given
  document.cookie = "XSRF-TOKEN=csrf";
  vi.spyOn(api, "accountMfa").mockResolvedValue({ enabled: true, recoveryPending: false });
  let finish!: (response: Response) => void;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const events = vi.spyOn(window, "dispatchEvent");
  const failed = vi.fn();
  const run = async (action: () => Promise<void>) => { await action().catch(failed); };
  const owner = proofOwnerHarness();
  render(<AdminMfaRecovery accountId="account-1" disabled={false} run={run} />, { wrapper: owner.Wrapper });
  fireEvent.click(await screen.findByTestId("admin-mfa-identity-checked"));
  fireEvent.click(screen.getByTestId("admin-mfa-recover"));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  // when
  if (changed) act(() => owner.change());
  await act(async () => {
    finish(new Response(JSON.stringify({ type: "urn:courtside:error:unauthenticated", status: 401 }), { status: 401, headers: { "Content-Type": "application/problem+json" } }));
    await Promise.resolve();
  });
  // then
  await waitFor(() => expect(failed).toHaveBeenCalledOnce());
  expect(events.mock.calls.some(([event]) => event.type === "courtside:unauthenticated")).toBe(!changed);
  expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(changed);
});
