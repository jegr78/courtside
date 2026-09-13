import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repository = fileURLToPath(new URL("..", import.meta.url));
const catalogue = JSON.parse(readFileSync(
  new URL("../site/screenshots/captures.json", import.meta.url), "utf8"));

const IMAGE = /!\[([^\]]*)\]\(([^\s)]+)\)/g;

test("given the captured surfaces, when the guides are read, then each page shows what the "
  + "catalogue says it shows", () => {
  // given
  const expected = new Map();
  for (const { name, pages } of catalogue.captures) {
    for (const locale of catalogue.locales) {
      const page = pages[locale];
      assert.ok(page, `capture ${name} names no page for ${locale}`);
      if (!expected.has(page)) expected.set(page, { locale, images: [] });
      assert.equal(expected.get(page).locale, locale,
        `${page} is claimed for two locales`);
      expected.get(page).images.push(name);
    }
  }

  // when / then
  for (const [page, { locale, images }] of expected) {
    const source = readFileSync(resolve(repository, page), "utf8");
    const shown = [...source.matchAll(IMAGE)];
    assert.deepEqual(shown.map(([, , target]) => target).toSorted(),
      images.map((name) => relative(resolve(repository, page, ".."),
        resolve(repository, "site/screenshots", locale, `${name}.png`))).toSorted(),
      `${page} does not show exactly the captures the catalogue gives it`);
    for (const [, alt, target] of shown) {
      assert.notEqual(alt.trim(), "", `${page} shows ${target} without alt text`);
    }
  }
});

test("given the catalogue, when the capture files are read, then every locale carries every "
  + "surface", () => {
  // when / then
  for (const { name } of catalogue.captures) {
    for (const locale of catalogue.locales) {
      const file = `site/screenshots/${locale}/${name}.png`;
      assert.ok(existsSync(resolve(repository, file)), `${file} was never captured`);
    }
  }
});

test("given the capture run, when its drivers are read, then it drives exactly the catalogue's "
  + "surfaces, in exactly the catalogue's locales", () => {
  // given
  const spec = readFileSync(resolve(repository, "frontend/e2e/guide-screenshots.spec.ts"), "utf8");
  const config = readFileSync(resolve(repository, "frontend/playwright.config.ts"), "utf8");
  const body = spec.slice(spec.indexOf("const drivers"), spec.indexOf("\ntest("));
  assert.ok(body.length > 0, "the capture run declares no drivers");

  // when
  const driven = [...body.matchAll(/^ {2}"([a-z0-9-]+)":/gm)].map(([, name]) => name);
  const projects = [...config.matchAll(/name: "guides-([a-z]+)"/g)].map(([, locale]) => locale);

  // then
  assert.deepEqual(driven.toSorted(), catalogue.captures.map(({ name }) => name).toSorted(),
    "the capture run and the catalogue name different surfaces");
  assert.deepEqual(projects.toSorted(), [...catalogue.locales].toSorted(),
    "the capture projects and the catalogue name different locales");
});

test("given a guide, when it shows an image, then the catalogue declares it", () => {
  // given
  const declared = new Set(catalogue.captures.flatMap(({ name, pages }) =>
    catalogue.locales.map((locale) => `${pages[locale]}::${name}`)));

  // when / then
  for (const page of new Set(catalogue.captures.flatMap(({ pages }) =>
    catalogue.locales.map((locale) => pages[locale])))) {
    const source = readFileSync(resolve(repository, page), "utf8");
    for (const [, , target] of source.matchAll(IMAGE)) {
      const name = target.replace(/^.*\//, "").replace(/\.png$/, "");
      assert.ok(declared.has(`${page}::${name}`),
        `${page} shows ${target}, which the catalogue does not give it`);
    }
  }
});
