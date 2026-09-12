import { test, type Locator, type Page } from "@playwright/test";

// Playwright draws no cursor into a recording, so a reviewer sees results without seeing what was
// reached for. This paints one at the coordinates the synthesised events actually carry.
const POINTER = `
  const dot = document.createElement("div");
  dot.style.cssText = "position:fixed;z-index:2147483647;width:18px;height:18px;margin:-9px 0 0 -9px;"
    + "border-radius:50%;border:2px solid #ff3b30;background:rgba(255,59,48,.25);pointer-events:none;"
    + "opacity:0;transition:opacity .15s";
  const show = (x, y) => {
    dot.style.left = x + "px";
    dot.style.top = y + "px";
    dot.style.opacity = "1";
  };
  addEventListener("DOMContentLoaded", () => document.body.append(dot));
  addEventListener("mousemove", (event) => show(event.clientX, event.clientY), true);
  addEventListener("pointerdown", (event) => show(event.clientX, event.clientY), true);
  addEventListener("touchstart", (event) => show(event.touches[0].clientX, event.touches[0].clientY), true);
`;

function reachedByTouch(): boolean {
  return test.info().project.use.hasTouch === true;
}

export async function openTheApplication(page: Page): Promise<void> {
  await page.addInitScript(POINTER);
  await page.goto("/");
}

export async function activate(target: Locator): Promise<void> {
  await (reachedByTouch() ? target.tap() : target.click());
}

// A member types; a debounced search, an input mask and a maxlength all see the keystrokes that
// locator.fill() would have replaced with a single input event.
export async function writeInto(target: Locator, text: string): Promise<void> {
  await target.pressSequentially(text, { delay: 60 });
}
