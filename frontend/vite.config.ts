import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost" } },
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"]
  }
});
