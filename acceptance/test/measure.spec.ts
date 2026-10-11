import { test, expect } from "@playwright/test";
import { measure } from "../lib/checks";

const page = (body: string) => `data:text/html,<html><body style="margin:0">${encodeURIComponent(body)}</body></html>`;

test("given an element wider than the viewport, when measured, then it is reported as overflow", async ({ page: p }) => {
  // given
  await p.setViewportSize({ width: 320, height: 600 });
  await p.goto(page(`<div id="wide" style="width:500px;height:20px">x</div>`));
  // when
  const result = await measure(p, "de");
  // then
  expect(result.documentOverflow, "document scrolls sideways").toBe(true);
  expect(result.overflow.map((item) => item.selector)).toContain("div#wide");
});

test("given a wide child inside a horizontal scroller, when measured, then it is not reported", async ({ page: p }) => {
  // given
  await p.setViewportSize({ width: 320, height: 600 });
  await p.goto(page(`<div style="overflow-x:auto;width:300px"><div id="inner" style="width:900px">x</div></div>`));
  // when
  const result = await measure(p, "de");
  // then
  expect(result.overflow, "content of a scroller is not overflow").toEqual([]);
});

test("given a fixed bar over a button, when measured, then the button is occluded", async ({ page: p }) => {
  // given
  await p.goto(page(`<button id="go" style="position:absolute;top:10px">Go</button>
    <div style="position:fixed;top:0;left:0;right:0;height:60px;background:red"></div>`));
  // when
  const result = await measure(p, "de");
  // then
  expect(result.occluded.map((item) => item.selector)).toContain("button#go");
});

test("given a raw message key and German text on an English page, when measured, then both are reported", async ({ page: p }) => {
  // given
  await p.goto(page(`<p>booking.dialog.submitLabel</p><p>Platz buchen für Mitglieder</p>`));
  // when
  const result = await measure(p, "en");
  // then
  expect(result.i18nKeys).toContain("booking.dialog.submitLabel");
  expect(result.germanOnEn.length, "German words found").toBeGreaterThan(0);
});

test("given a clean page, when measured, then nothing is reported", async ({ page: p }) => {
  // given
  await p.goto(page(`<main><h1>Plan</h1><p>Contact us at club.example.org or board@example.org</p><button style="min-height:48px;min-width:48px">Book</button></main>`));
  // when
  const result = await measure(p, "en");
  // then
  expect([result.documentOverflow, result.overflow, result.occluded, result.i18nKeys, result.germanOnEn])
    .toEqual([false, [], [], [], []]);
});

test("given an open modal, when measured, then only controls inside the modal are checked for occlusion", async ({ page: p }) => {
  // given
  await p.goto(page(`<a id="behind" href="#" style="position:absolute;top:20px;left:20px">Behind</a>
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.5)"></div>
    <div role="dialog" aria-modal="true" style="position:fixed;top:100px;left:100px;width:200px;height:100px;background:white">
      <button id="inside">OK</button></div>`));
  // when
  const result = await measure(p, "de");
  // then
  expect(result.occluded, "background behind a modal is not occlusion").toEqual([]);
});

test("given a control scrolled out of its scroller, when measured, then it is not occluded", async ({ page: p }) => {
  // given
  await p.setViewportSize({ width: 320, height: 600 });
  await p.goto(page(`<div style="display:flex;overflow-x:auto;width:200px;position:relative">
    <button style="flex:0 0 150px">A</button><button id="far" style="flex:0 0 150px">B</button></div>
    <button style="position:absolute;left:210px;top:0;width:100px">Now</button>`));
  // when
  const result = await measure(p, "de");
  // then
  expect(result.occluded, "a control outside its scroller's visible box is not occluded").toEqual([]);
});

test("given a link inside a transparent closed menu, when measured, then it is neither occluded nor overflowing", async ({ page: p }) => {
  // given
  await p.setViewportSize({ width: 320, height: 600 });
  await p.goto(page(`<p style="position:relative;z-index:1;background:white">Text over the menu</p>
    <div style="opacity:0;position:absolute;top:0;left:200px;width:300px"><a id="menu-link" href="#">Account</a></div>`));
  // when
  const result = await measure(p, "de");
  // then
  expect([result.occluded, result.overflow]).toEqual([[], []]);
});
