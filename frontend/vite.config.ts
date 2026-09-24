import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    minify: "oxc",
    sourcemap: false
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      manifest: false,
      registerType: "prompt",
      workbox: {
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.method === "GET"
              && url.pathname === "/api/my/bookings" && !url.searchParams.has("cursor"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "courtside-personal-bookings",
              plugins: [{
                handlerWillStart: async ({ state }) => {
                  const control = await caches.open("courtside-personal-bookings-control");
                  const markerUrl = new URL("/.courtside/personal-bookings-generation", self.location.origin).href;
                  const marker = await control.match(markerUrl);
                  if (marker) {
                    state.generation = await marker.text();
                    return;
                  }
                  state.generation = crypto.randomUUID();
                  await control.put(markerUrl, new Response(state.generation as string));
                },
                cacheKeyWillBeUsed: ({ request }) => {
                  const key = new URL("/api/my/bookings?limit=50", request.url);
                  return Promise.resolve(new Request(key, request));
                },
                cachedResponseWillBeUsed: async ({ cacheName, cachedResponse, state }) => {
                  if (!cachedResponse) return null;
                  const cachedAt = Number(cachedResponse.headers.get("x-courtside-cached-at"));
                  const age = Date.now() - cachedAt;
                  const control = await caches.open("courtside-personal-bookings-control");
                  const marker = await control.match(new URL(
                    "/.courtside/personal-bookings-generation", self.location.origin).href);
                  const generation = marker ? await marker.text() : undefined;
                  if (generation === state.generation
                    && cachedResponse.headers.get("x-courtside-cache-generation") === generation
                    && Number.isFinite(age) && age >= 0 && age <= 7 * 24 * 60 * 60 * 1_000) {
                    return cachedResponse;
                  }
                  await caches.delete(cacheName);
                  return null;
                },
                cacheWillUpdate: async ({ response, state }) => {
                  if (response.status !== 200) return null;
                  const page = await response.clone().json() as {
                    items: Array<Record<string, unknown>>;
                    refreshedAt?: string;
                    timeZone?: string;
                    courts?: unknown[];
                  };
                  const control = await caches.open("courtside-personal-bookings-control");
                  const marker = await control.match(new URL("/.courtside/personal-bookings-generation", self.location.origin).href);
                  const generation = marker ? await marker.text() : "initial";
                  if (state.generation !== generation) return null;
                  const offlinePage = {
                    items: page.items.map((booking) => ({
                      id: booking.id,
                      seriesId: booking.seriesId,
                      courtIds: booking.courtIds,
                      startsAt: booking.startsAt,
                      endsAt: booking.endsAt,
                      cardLabel: booking.cardLabel,
                      cardColor: booking.cardColor,
                      status: booking.status
                    })),
                    refreshedAt: page.refreshedAt,
                    timeZone: page.timeZone,
                    courts: page.courts
                  };
                  const headers = new Headers(response.headers);
                  headers.delete("content-length");
                  headers.set("x-courtside-cached-at", String(Date.now()));
                  headers.set("x-courtside-cache-generation", String(state.generation));
                  return new Response(JSON.stringify(offlinePage), {
                    status: response.status, statusText: response.statusText, headers
                  });
                },
                cacheDidUpdate: async ({ cacheName, request, state }) => {
                  const control = await caches.open("courtside-personal-bookings-control");
                  const marker = await control.match(new URL("/.courtside/personal-bookings-generation", self.location.origin).href);
                  const generation = marker ? await marker.text() : "initial";
                  if (state.generation === generation) return;
                  await (await caches.open(cacheName)).delete(request);
                }
              }]
            }
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly"
          }
        ]
      }
    })
  ],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://localhost:8080",
      "/actuator": "http://localhost:8080",
      "/manifest.webmanifest": "http://localhost:8080"
    }
  },
  test: {
    execArgv: ["--no-experimental-webstorage"],
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost" } },
    maxWorkers: 2,
    include: ["src/**/*.test.{ts,tsx}", "e2e/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/api/schema.d.ts"],
      thresholds: {
        statements: 89,
        branches: 85,
        functions: 86,
        lines: 92
      }
    }
  }
});
