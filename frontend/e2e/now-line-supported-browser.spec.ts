import { expect, test } from "./fixtures";

test.use({ serviceWorkers: "block" });

for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 852, height: 393 },
  { width: 1440, height: 800 }
]) {
  test(`given a ${viewport.width} by ${viewport.height} screen, when today's plan opens between slots, then its hour and now-line stay below the court header`, async ({ page, journeyService }) => {
    test.setTimeout(60_000);
    // given
    await page.setViewportSize(viewport);
    const instant = new Date(`${journeyService.visualDate}T16:15:00Z`);
    await page.clock.setFixedTime(instant);
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(instant);

    // when
    await page.goto("/login");
    await page.getByTestId("username").fill("doe.jane");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("current-time-line")).toBeVisible({ timeout: 10_000 });

    // then
    const [line, row, header] = await Promise.all([
      page.getByTestId("current-time-line").boundingBox(),
      page.getByTestId(`slot-heading-${hour}:00`).boundingBox(),
      page.getByTestId("day-plan-table").locator("thead th").first().boundingBox()
    ]);
    expect(line).not.toBeNull();
    expect(row).not.toBeNull();
    expect(header).not.toBeNull();
    const visibleBottom = await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>('[data-testid="primary-navigation-bar"]');
      return bar && getComputedStyle(bar).position === "fixed" ? bar.getBoundingClientRect().top : window.innerHeight;
    });
    expect(row!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
    expect(row!.y + row!.height, "the current hour ends above the fixed navigation bar").toBeLessThanOrEqual(visibleBottom + 1);
    expect(line!.y).toBeGreaterThanOrEqual(row!.y);
    expect(line!.y + line!.height).toBeLessThanOrEqual(row!.y + row!.height);
    expect(line!.y + line!.height, "the now-line ends above the fixed navigation bar").toBeLessThanOrEqual(visibleBottom);
  });
}
