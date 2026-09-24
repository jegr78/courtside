import { afterEach, expect, it, vi } from "vitest";
import {
  clearPersonalBookingsOfflineData, offlineMemberSession, PERSONAL_BOOKINGS_CACHE, PERSONAL_BOOKINGS_CONTROL_CACHE
} from "./offlineBookings";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("restores only member authority while a recent personal-booking response exists", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  const generation = "generation-1";
  const match = vi.fn().mockResolvedValue({
    headers: new Headers({ "x-courtside-cache-generation": generation }),
    clone: () => ({ json: () => Promise.resolve({ refreshedAt: "2026-09-23T12:00:00Z" }) })
  });
  const request = new Request("http://localhost/api/my/bookings?limit=50");
  vi.stubGlobal("caches", {
    open: vi.fn().mockImplementation((name: string) => Promise.resolve(name === PERSONAL_BOOKINGS_CACHE
      ? { keys: () => Promise.resolve([request]), match }
      : { match: () => Promise.resolve(new Response(generation)) })),
    delete: vi.fn().mockResolvedValue(true)
  });

  await expect(offlineMemberSession()).resolves.toEqual({
    authenticated: true, roles: ["MEMBER"], passwordChangeRequired: false
  });
  expect(match).toHaveBeenCalledWith(request);
});

it("refuses an expired personal-booking response and removes its cache", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  const generation = "generation-1";
  const remove = vi.fn().mockResolvedValue(true);
  const request = new Request("http://localhost/api/my/bookings?limit=50");
  const put = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("caches", {
    open: vi.fn().mockImplementation((name: string) => Promise.resolve(name === PERSONAL_BOOKINGS_CACHE ? {
      keys: () => Promise.resolve([request]), match: vi.fn().mockResolvedValue({
        headers: new Headers({ "x-courtside-cache-generation": generation }),
        clone: () => ({ json: () => Promise.resolve({ refreshedAt: "2026-09-09T12:00:00Z" }) })
      })
    } : {
      match: () => Promise.resolve(new Response(generation)),
      delete: () => Promise.resolve(true),
      put
    })),
    delete: remove
  });

  await expect(offlineMemberSession()).resolves.toBeUndefined();
  expect(remove).toHaveBeenCalledWith(PERSONAL_BOOKINGS_CACHE);
});

it("refuses a personal-booking response whose refresh time lies in the future", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  const generation = "generation-1";
  const remove = vi.fn().mockResolvedValue(true);
  const request = new Request("http://localhost/api/my/bookings?limit=50");
  vi.stubGlobal("caches", {
    open: vi.fn().mockImplementation((name: string) => Promise.resolve(name === PERSONAL_BOOKINGS_CACHE ? {
      keys: () => Promise.resolve([request]), match: () => Promise.resolve({
        headers: new Headers({ "x-courtside-cache-generation": generation }),
        clone: () => ({ json: () => Promise.resolve({ refreshedAt: "2026-09-24T12:01:00Z" }) })
      })
    } : {
      match: () => Promise.resolve(new Response(generation)),
      delete: () => Promise.resolve(true),
      put: () => Promise.resolve()
    })),
    delete: remove
  });

  await expect(offlineMemberSession()).resolves.toBeUndefined();
  expect(remove).toHaveBeenCalledWith(PERSONAL_BOOKINGS_CACHE);
});

it("does not invent an offline session without a cached response", async () => {
  vi.stubGlobal("caches", {
    open: vi.fn().mockImplementation((name: string) => Promise.resolve(name === PERSONAL_BOOKINGS_CACHE
      ? { keys: () => Promise.resolve([]), match: vi.fn() }
      : { match: () => Promise.resolve(new Response("generation-1")) })),
    delete: vi.fn()
  });

  await expect(offlineMemberSession()).resolves.toBeUndefined();
});

it("refuses a cached response from an invalidated account generation", async () => {
  const request = new Request("http://localhost/api/my/bookings?limit=50");
  vi.stubGlobal("caches", {
    open: vi.fn().mockImplementation((name: string) => Promise.resolve(name === PERSONAL_BOOKINGS_CACHE
      ? {
          keys: () => Promise.resolve([request]),
          match: () => Promise.resolve({ headers: new Headers({ "x-courtside-cache-generation": "old" }) })
        }
      : { match: () => Promise.resolve(new Response("current")) })),
    delete: vi.fn().mockResolvedValue(true)
  });

  await expect(offlineMemberSession()).resolves.toBeUndefined();
});

it("reopens the control cache before granting offline authority", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  const request = new Request("http://localhost/api/my/bookings?limit=50");
  let controlOpens = 0;
  vi.stubGlobal("caches", {
    open: vi.fn().mockImplementation((name: string) => {
      if (name === PERSONAL_BOOKINGS_CACHE) return Promise.resolve({
        keys: () => Promise.resolve([request]), match: () => Promise.resolve({
          headers: new Headers({ "x-courtside-cache-generation": "old" }),
          clone: () => ({ json: () => Promise.resolve({ refreshedAt: "2026-09-23T12:00:00Z" }) })
        })
      });
      controlOpens += 1;
      return Promise.resolve({
        match: () => Promise.resolve(new Response(controlOpens === 1 ? "old" : "new"))
      });
    }),
    delete: vi.fn().mockResolvedValue(true)
  });

  await expect(offlineMemberSession()).resolves.toBeUndefined();
  expect(controlOpens).toBe(2);
});

it("publishes a new invalidation marker before removing personal booking data", async () => {
  const marker = "00000000-0000-4000-8000-000000000001";
  vi.spyOn(crypto, "randomUUID").mockReturnValue(marker);
  const deleteMarker = vi.fn().mockResolvedValue(true);
  const put = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue(true);
  const open = vi.fn().mockResolvedValue({ delete: deleteMarker, put });
  vi.stubGlobal("caches", { open, delete: remove });

  await clearPersonalBookingsOfflineData();

  expect(open).toHaveBeenCalledWith(PERSONAL_BOOKINGS_CONTROL_CACHE);
  expect(put).toHaveBeenCalledOnce();
  expect(put.mock.calls[0][0]).toBe("/.courtside/personal-bookings-generation");
  await expect((put.mock.calls[0][1] as Response).text()).resolves.toBe(marker);
  expect(deleteMarker).toHaveBeenCalledWith("/.courtside/personal-bookings-generation");
  expect(deleteMarker.mock.invocationCallOrder[0]).toBeLessThan(put.mock.invocationCallOrder[0]);
  expect(put.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
  expect(remove).toHaveBeenCalledWith(PERSONAL_BOOKINGS_CACHE);
});

it("clears personal booking data without making cache failures break sign-out", async () => {
  const remove = vi.fn().mockRejectedValue(new Error("storage unavailable"));
  vi.stubGlobal("caches", { open: vi.fn().mockRejectedValue(new Error("storage unavailable")), delete: remove });

  await expect(clearPersonalBookingsOfflineData()).resolves.toBeUndefined();
  expect(remove).toHaveBeenCalledWith(PERSONAL_BOOKINGS_CACHE);
});
