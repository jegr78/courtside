import { test, expect } from "@playwright/test";
import { LOADING_NOTICE, settle } from "../lib/checks";

const page = (body: string) => `data:text/html,<html><body>${encodeURIComponent(body)}</body></html>`;
const lateNotice = (markup: string, appearAfter: number, leaveAfter: number) => `<h1>Rules</h1><script>
  setTimeout(() => { document.body.insertAdjacentHTML("beforeend", '${markup}'); }, ${appearAfter});
  setTimeout(() => { document.getElementById("notice").remove(); window.noticeGone = true; }, ${leaveAfter});
</script>`;

test("given a loading notice that appears after the heading, when the page settles, then settling waits until it is gone", async ({ page: p }) => {
  // given
  await p.goto(page(lateNotice('<p id="notice" role="status">Loading</p>', 300, 1_500)));

  // when
  const settled = await settle(p);

  // then
  expect(settled, "the page settles once the notice is gone").toBe(true);
  expect(await p.evaluate(() => (window as { noticeGone?: boolean }).noticeGone), "settling returns only after the late notice has come and gone").toBe(true);
  expect(await p.locator(LOADING_NOTICE).count(), "no loading notice remains when settling returns").toBe(0);
});

test("given a polite live loading notice, when the page settles, then settling waits for it as well", async ({ page: p }) => {
  // given
  await p.goto(page(lateNotice('<p id="notice" aria-live="polite">Loading</p>', 100, 1_200)));

  // when
  const settled = await settle(p);

  // then
  expect(settled, "the page settles once the notice is gone").toBe(true);
  expect(await p.evaluate(() => (window as { noticeGone?: boolean }).noticeGone), "an aria-live notice counts as loading").toBe(true);
});

test("given a loading notice that never leaves, when the page settles, then it is reported as unsettled", async ({ page: p }) => {
  // given
  await p.goto(page('<h1>Rules</h1><p role="status">Loading</p>'));

  // when
  const settled = await settle(p, 1_500);

  // then
  expect(settled, "a page still loading at the deadline is not settled").toBe(false);
});

test("given a status message with its own test id, when the page settles, then it does not count as loading", async ({ page: p }) => {
  // given
  await p.goto(page('<h1>Rules</h1><p role="status" data-testid="saved">Saved</p>'));

  // when
  const settled = await settle(p, 1_500);

  // then
  expect(settled, "a named status message is content, not a loading notice").toBe(true);
});
