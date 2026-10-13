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

const POLICY_HEADERS = ["content-security-policy", "cache-control", "x-frame-options", "x-content-type-options",
  "referrer-policy", "strict-transport-security", "permissions-policy", "content-type"];

for (const path of ["/", "/my-bookings"]) {
  test(`given the proxy, when ${path} is asked for with HEAD, then it carries the policy headers of GET`, async ({ page }) => {
    // given
    const policyOf = (headers: Record<string, string>) =>
      Object.fromEntries(POLICY_HEADERS.map((name) => [name, headers[name]]));
    // The browser trusts the test authority by a key pin that the request context cannot share.
    const options = { maxRedirects: 0, ignoreHTTPSErrors: true };

    // when
    const get = await page.request.get(path, options);
    const head = await page.request.head(path, options);

    // then
    expect(get.status(), `GET ${path} is served`).toBe(200);
    expect(head.status(), `HEAD ${path} answers as GET does`).toBe(200);
    expect(head.headers()["content-security-policy"], `HEAD ${path} carries the application's policy, not only the proxy's`)
      .toContain("default-src 'self'");
    expect(policyOf(head.headers()), `HEAD ${path} carries the policy headers of GET`).toEqual(policyOf(get.headers()));
  });
}
