import { expect, test } from "./fixtures";

test("supported browsers receive the CSP and clickjacking boundary", async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as typeof globalThis & { courtsideBaseViolations: string[] }).courtsideBaseViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      if (event.effectiveDirective === "base-uri") {
        (globalThis as typeof globalThis & { courtsideBaseViolations: string[] })
          .courtsideBaseViolations.push(event.blockedURI);
      }
    });
  });
  // when
  const response = await page.goto("/");
  const relativeTarget = await page.evaluate(() => {
    const base = document.createElement("base");
    base.href = "https://attacker.example/";
    document.head.prepend(base);
    const link = document.createElement("a");
    link.href = "relative-probe";
    return link.href;
  });

  // then
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toContain("base-uri 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(new URL(relativeTarget).origin).toBe(new URL(page.url()).origin);
  await expect.poll(() => page.evaluate(() =>
    (globalThis as typeof globalThis & { courtsideBaseViolations: string[] }).courtsideBaseViolations))
    .toContain("https://attacker.example/");
});
