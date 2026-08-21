import { expect, test } from "./fixtures";

test("supported browsers receive the CSP and clickjacking boundary", async ({ page }) => {
  // when
  const response = await page.goto("/");

  // then
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
});
