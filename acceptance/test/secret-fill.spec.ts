import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fillSecret } from "../lib/secret-fill";
import { readZip } from "../lib/redaction.mjs";

const SECRET = "Shared!pass word&9";
const form = `data:text/html,${encodeURIComponent(`<label>Passwort <input id="secret" type="password"></label><output id="typed"></output>
  <input id="locked" type="password" disabled>
  <script>document.getElementById("secret").addEventListener("input", (event) => { document.getElementById("typed").value = String(event.target.value.length); });</script>`)}`;

test("given a password field, when a secret is filled, then the page has it and no recorded action or log line carries it", async ({ page, context }, info) => {
  // given
  await page.goto(form);
  await context.tracing.start({ snapshots: true });

  // when
  await fillSecret(page.locator("#secret"), SECRET);

  // then
  const trace = info.outputPath("trace.zip");
  await context.tracing.stop({ path: trace });
  expect(await page.locator("#typed").textContent(), "the page's input listener saw every character").toBe(String(SECRET.length));
  expect(await page.locator("#secret").inputValue() === SECRET, "the field holds the secret").toBe(true);
  const events = readZip(readFileSync(trace)).filter((entry) => entry.name.endsWith(".trace"))
    .flatMap((entry) => entry.data.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type: string }));
  const carrying = events.filter((event) => event.type !== "frame-snapshot" && JSON.stringify(event).includes("Shared!pass"));
  expect(carrying.map((event) => event.type), "no action parameter, result or log line holds the secret").toEqual([]);
});

test("given a field that refuses input, when a secret is filled, then the failure does not name the secret", async ({ page }) => {
  // given
  await page.goto(form);

  // when
  const failure = await fillSecret(page.locator("#locked"), SECRET).then(() => undefined, (error: Error) => error);

  // then
  expect(failure, "a disabled field is refused").toBeDefined();
  expect(failure!.message.includes("Shared!pass"), "the error message leaves the secret out").toBe(false);
});
