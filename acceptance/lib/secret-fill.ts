import { randomUUID } from "node:crypto";
import type { BrowserContext, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

const pending = new Map<string, string>();
const exposed = new WeakSet<BrowserContext>();

/** Types a secret into an input so that no Playwright action, log line or error message carries the value. */
export async function fillSecret(target: Locator, secret: string) {
  const context = target.page().context();
  if (!exposed.has(context)) {
    exposed.add(context);
    await context.exposeBinding("__acceptanceSecret", (_source, key: string) => {
      const value = pending.get(key);
      pending.delete(key);
      return value;
    });
  }
  await expect(target).toBeEditable();
  const key = randomUUID();
  pending.set(key, secret);
  try {
    await target.evaluate(async (input: HTMLInputElement, handle: string) => {
      const value = await (window as unknown as { __acceptanceSecret: (key: string) => Promise<string | undefined> }).__acceptanceSecret(handle);
      if (value === undefined) throw new Error("the secret was already taken");
      input.focus();
      // A framework that tracks the value property would ignore a plain assignment.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, key);
  } finally {
    pending.delete(key);
  }
}
