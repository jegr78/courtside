import { test, expect, devices } from "@playwright/test";
import { fullPageShot } from "../lib/checks";

test.use({ ...devices["Pixel 7"] });

const page = `data:text/html,${encodeURIComponent(`<html><head><meta name="viewport" content="width=device-width"></head><body style="margin:0">
  <nav style="position:sticky;top:0;height:98px;background:#ccc">Days</nav>
  <div style="height:4000px">Plan</div>
  <footer style="position:fixed;bottom:0;width:100%;height:60px;background:#ccc">Plan Bookings Messages</footer></body></html>`)}`;

test("given a phone page with a fixed tab bar scrolled down, when the full page is captured, then the page stays where it was", async ({ page: p }, info) => {
  // given
  await p.goto(page);
  await p.evaluate(() => window.scrollTo(0, 275));

  // when
  await fullPageShot(p, info.outputPath("full.png"));

  // then
  expect(await p.evaluate(() => window.scrollY), "the next viewport capture shows what the member saw").toBe(275);
});
