import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { JourneyLanguage } from "./fixtures";

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

export async function openTheApplication(page: Page, language: JourneyLanguage): Promise<void> {
  await page.addInitScript(POINTER);
  await page.goto("/");
  await chooseTheLanguage(page, language);
}

// The application reads the stored preference and never Accept-Language, so a journey that wants
// to be walked in English has to say so where a member says so.
async function chooseTheLanguage(page: Page, language: JourneyLanguage): Promise<void> {
  const menu = page.getByTestId("preferences-menu");
  await activate(menu);
  await page.locator("#locale-preference").selectOption(language);
  await activate(menu);
}

export async function activate(target: Locator): Promise<void> {
  await (reachedByTouch() ? target.tap() : target.click());
}

// A member types; a debounced search, an input mask and a maxlength all see the keystrokes that
// locator.fill() would have replaced with a single input event.
export async function writeInto(target: Locator, text: string): Promise<void> {
  await target.pressSequentially(text, { delay: 60 });
}

// Correcting a typed value is select-all and type over it, the way a person does it; clear()
// empties the field without a keystroke reaching the page.
export async function rewrite(target: Locator, text: string): Promise<void> {
  await target.press("ControlOrMeta+a");
  await writeInto(target, text);
}

export async function signIn(page: Page, username: string, password = "temporary-password"): Promise<void> {
  const link = page.getByTestId("sign-in-link");
  // A member reaches the form from the plan, but a sign-out already left them standing on it.
  await expect(link.or(page.getByTestId("login-view"))).toBeVisible();
  if (await link.count() > 0) await activate(link);
  await expect(page.getByTestId("login-view")).toBeVisible();
  await writeInto(page.getByTestId("username"), username);
  await writeInto(page.getByTestId("password"), password);
  await activate(page.getByTestId("login-submit"));
}

// A date field takes digits in the order the browser prints, not the order the value is stored in.
// The value it produces is always ISO, so the assertion says which order was actually typed.
export async function writeDate(target: Locator, isoDate: string): Promise<void> {
  const [year, month, day] = isoDate.split("-");
  await target.press("ControlOrMeta+a");
  await writeInto(target, `${month}${day}${year}`);
  await expect(target).toHaveValue(isoDate);
}

// The operating system's picker cannot be driven, so a journey hands the input a path to a file
// that is in the repository the way a member's own export is on their disk.
export function journeyFile(name: string): string {
  return join(__dirname, "journey-files", name);
}

export async function writeTime(target: Locator, time: string): Promise<void> {
  await target.press("ControlOrMeta+a");
  await writeInto(target, time.replace(":", ""));
  await expect(target).toHaveValue(time);
}

// Account and appearance sit behind one control in the header, so what it holds is out of reach
// until a member opens it.
export async function openTheAccountMenu(page: Page): Promise<void> {
  await activate(page.getByTestId("preferences-menu"));
}

export async function signOut(page: Page): Promise<void> {
  const menu = page.getByTestId("preferences-menu");
  await activate(menu);
  await activate(page.getByTestId("logout"));
  await expect(page.getByTestId("login-view").or(page.getByTestId("sign-in-link"))).toBeVisible();
}

// The coverage guard reads the workflow each journey declares here, so a journey that walks a
// workflow nobody else reaches cannot be counted by a list kept somewhere else.
export function walks(...workflows: string[]): { annotation: { type: string; description: string }[] } {
  return { annotation: workflows.map((workflow) => ({ type: "workflow", description: workflow })) };
}
