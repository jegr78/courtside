import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repository = fileURLToPath(new URL("..", import.meta.url));
const catalogue = JSON.parse(readFileSync(
  new URL("../site/screenshots/captures.json", import.meta.url), "utf8"));

const IMAGE = /!\[([^\]]*)\]\(([^\s)]+)\)/g;
const SECTION = /^## +(.+)$/m;
const SHOWS_AN_IMAGE = /!\[[^\]]*\]\([^\s)]+\)/;

// A guide is what a member or a board is told to read; index.md is the shelf those guides stand
// on, so it carries links rather than passages and no surface of its own.
function guidePages() {
  return ["site", "site/en"].flatMap((directory) => readdirSync(resolve(repository, directory))
    .filter((name) => name.endsWith("-guide.md")).map((name) => `${directory}/${name}`));
}

function sections(source) {
  const parts = source.split(SECTION);
  return parts.slice(1).reduce((found, part, index) => index % 2 === 0
    ? [...found, { heading: part.trim(), body: "" }]
    : [...found.slice(0, -1), { ...found[found.length - 1], body: part }], []);
}

// The passage describes a message the instance sends. There is no screen behind it to show, and a
// picture of another one would illustrate the wrong thing.
const NO_SCREEN_SHOWS_THIS = {
  "site/member-guide.md": ["Wenn sich unter deiner Buchung etwas ändert"],
  "site/en/member-guide.md": ["When something under your booking changes"]
};

test("given the captured surfaces, when the guides are read, then each page shows what the "
  + "catalogue says it shows", () => {
  // given
  const expected = new Map();
  for (const { name, pages } of catalogue.captures) {
    for (const locale of catalogue.locales) {
      const page = pages[locale];
      // The catalogue builds the paths this test reads, so it carries its own bound rather than
      // borrowing one from whichever test node:test happens to run first.
      assert.match(page ?? "", /^site\/(?:[a-z]{2}\/)?[a-z-]+\.md$/,
        `capture ${name} names no guide page for ${locale}`);
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
    assert.match(name, /^[a-z0-9-]+$/, `capture ${name} is not a plain name`);
    for (const locale of catalogue.locales) {
      assert.match(locale, /^[a-z]{2}$/, `locale ${locale} is not a plain language tag`);
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

test("given a guide, when a section is read, then it shows the surface the passage describes", () => {
  // given
  const pages = guidePages();
  assert.notEqual(pages.length, 0, "the site carries no guide");

  // when / then
  for (const page of pages) {
    const found = sections(readFileSync(resolve(repository, page), "utf8"));
    assert.notEqual(found.length, 0, `${page} is a guide without a section`);
    const exempt = NO_SCREEN_SHOWS_THIS[page] ?? [];
    for (const heading of exempt) {
      assert.ok(found.some((section) => section.heading === heading),
        `${page} has no section "${heading}" for its exemption to cover`);
    }
    for (const { heading, body } of found.filter((section) => !exempt.includes(section.heading))) {
      assert.match(body, SHOWS_AN_IMAGE, `${page} describes "${heading}" without showing it`);
    }
  }
});

test("given a capture, when it is shown, then it illustrates the same passage in every locale", () => {
  // when / then
  for (const { name, pages } of catalogue.captures) {
    const passages = catalogue.locales.map((locale) => {
      const found = sections(readFileSync(resolve(repository, pages[locale]), "utf8"));
      const passage = found.findIndex(({ body }) => body.includes(`/${name}.png`));
      assert.notEqual(passage, -1, `${pages[locale]} shows ${name} outside any section`);
      return passage;
    });
    assert.equal(new Set(passages).size, 1,
      `${name} illustrates a different passage per locale`);
  }
});
