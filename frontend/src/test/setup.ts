import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom implements no media queries at all, so a width query is answered from the window itself.
window.matchMedia = (media: string) => {
  const minimum = Number(/\d+/.exec(media)?.[0] ?? 0);
  const query = new EventTarget() as MediaQueryList;
  Object.defineProperty(query, "matches", { get: () => window.innerWidth >= minimum });
  Object.defineProperty(query, "media", { get: () => media });
  window.addEventListener("resize", () => query.dispatchEvent(new Event("change")));
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
