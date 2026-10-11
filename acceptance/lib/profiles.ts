import { devices } from "@playwright/test";

export type Profile = { name: string; engine: "chromium" | "firefox" | "webkit"; use: Record<string, unknown>;
  theme: "light" | "dark"; locale: "de" | "en"; phone: boolean };

const desk = (width: number, height: number) => ({ viewport: { width, height } });
const strip = ({ defaultBrowserType, ...rest }: Record<string, unknown>) => rest;

export const PROFILES: Profile[] = [
  { name: "desktop-chrome", engine: "chromium", use: desk(1440, 900), theme: "dark", locale: "de", phone: false },
  { name: "desktop-firefox", engine: "firefox", use: desk(1280, 800), theme: "light", locale: "en", phone: false },
  { name: "desktop-safari", engine: "webkit", use: desk(1440, 900), theme: "light", locale: "de", phone: false },
  { name: "ipad", engine: "webkit", use: { ...strip(devices["iPad Pro 11"]), viewport: { width: 820, height: 1180 } }, theme: "dark", locale: "en", phone: false },
  { name: "iphone-se", engine: "webkit", use: strip(devices["iPhone SE (3rd gen)"]), theme: "light", locale: "de", phone: true },
  { name: "iphone-15-de", engine: "webkit", use: strip(devices["iPhone 15"]), theme: "dark", locale: "de", phone: true },
  { name: "iphone-15-en", engine: "webkit", use: strip(devices["iPhone 15"]), theme: "light", locale: "en", phone: true },
  { name: "iphone-15-landscape", engine: "webkit", use: strip(devices["iPhone 15 landscape"]), theme: "dark", locale: "de", phone: true },
  { name: "pixel-7", engine: "chromium", use: strip(devices["Pixel 7"]), theme: "light", locale: "en", phone: true },
  { name: "narrow", engine: "chromium", use: { ...strip(devices["Pixel 7"]), viewport: { width: 320, height: 640 } }, theme: "dark", locale: "de", phone: true }
];
for (const profile of PROFILES) if (!profile.use.viewport) throw new Error(`unknown device for ${profile.name}`);
