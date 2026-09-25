import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const repository = new URL("../", import.meta.url);

function read(path) {
  return readFileSync(new URL(path, repository), "utf8");
}

function markdownFiles(directory) {
  return readdirSync(new URL(directory, repository), { recursive: true })
    .filter((path) => path.endsWith(".md")
      && !path.startsWith("superpowers/")
      && !path.includes("node_modules/")
      && !path.includes(".vitepress/"))
    .map((path) => `${directory}${path}`);
}

const germanFiles = [
  "site/index.md",
  "site/member-guide.md",
  "site/board-guide.md",
  "src/main/resources/messages_de.properties",
  "src/main/resources/mail_de.properties",
];

const formalInstruction = new RegExp(
  String.raw`\b(?:[Ll]aden|[Tt]ragen|[Aa]ktivieren|[Dd]eaktivieren|[Vv]ersuchen|`
    + String.raw`[Kk]orrigieren|[Ww]ählen|[Pp]rüfen|[Öö]ffnen|[Nn]utzen|[Ss]peichern|`
    + String.raw`[Hh]interlegen|[Gg]eben|[Ss]tellen|[Aa]rbeiten|[Vv]erbinden|[Ee]rfassen|`
    + String.raw`[Vv]erwenden|[Ww]eisen|[Mm]arkieren|[Bb]eenden|[Ll]öschen|[Ff]ordern|`
    + String.raw`[Mm]elden|[Ää]ndern|[Ll]egen|[Ss]enden) Sie\b`
    + String.raw`|\b(?:Ihnen|Ihrem|Ihren|Ihrer|Ihres)\b`,
  "u",
);

test("given German user copy, when it addresses the reader, then it consistently uses du", () => {
  const germanFrontend = read("frontend/src/locales/de.ts");

  for (const path of germanFiles) {
    assert.doesNotMatch(read(path), formalInstruction, `${path} addresses the reader formally`);
  }
  assert.doesNotMatch(germanFrontend, formalInstruction,
    "the German frontend translations address the reader formally");
});

test("given maintained documentation and user copy, then it avoids typographic AI tells", () => {
  const paths = [
    "README.md",
    "deploy/README.md",
    "frontend/src/locales/de.ts",
    "frontend/src/locales/en.ts",
    "src/main/resources/messages.properties",
    "src/main/resources/messages_de.properties",
    "src/main/resources/mail.properties",
    "src/main/resources/mail_de.properties",
    ...markdownFiles("docs/"),
    ...markdownFiles("site/"),
  ];

  for (const path of paths) {
    assert.doesNotMatch(read(path), /[—–“”„]/u, `${path} contains a typographic AI tell`);
  }
});
