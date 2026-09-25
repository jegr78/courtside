import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Tests switch languages synchronously, so every bundle the browser fetches on demand is there already.
vi.mock("../i18n", async (importOriginal) => {
  const loaded = await importOriginal<typeof import("../i18n")>();
  const { default: en } = await import("../locales/en");
  loaded.default.addResourceBundle("en", "translation", en);
  return loaded;
});

// jsdom implements no media queries at all. This answers a width query from the window and refuses
// every other kind, because a stub that guesses would report a match nobody asked about.
const widthQueries = new Set<EventTarget>();

window.addEventListener("resize", () =>
  widthQueries.forEach((query) => query.dispatchEvent(new Event("change"))));

window.matchMedia = (media: string) => {
  const width = /^\(width >= (\d+)px\)$/.exec(media);
  if (!width) throw new Error(`The test setup answers width queries only, not "${media}"`);
  const query = new EventTarget() as MediaQueryList;
  Object.defineProperty(query, "matches", { get: () => window.innerWidth >= Number(width[1]) });
  Object.defineProperty(query, "media", { get: () => media });
  widthQueries.add(query);
  return query;
};

HTMLDialogElement.prototype.showModal = function showModal() {
  this.open = true;
};

HTMLDialogElement.prototype.close = function close() {
  this.open = false;
  this.dispatchEvent(new Event("close"));
};

afterEach(cleanup);
