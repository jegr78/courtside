import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = join(repository, "frontend");

// A query string this application builds is a request it sends, so new URLSearchParams({...}) in
// api/client.ts carries no external value and is deliberately not one of these.
const NAMED_READ = /\b(localStorage|sessionStorage|useParams|useSearchParams|useLocation|document\.cookie|document\.referrer|window\.name|history\.state)\b/g;
const LOCATION_READ = /\b(?:window\.)?location\.(?:protocol|href|search|hash|pathname|origin|assign|reload)/g;

const BOUNDARIES = {
  "src/App.tsx useLocation": {
    value: "the address the browser is on",
    classification: "decides which shell the route is shown in, and never a right",
    test: "src/App.test.tsx#given an admin session, when opening an administrative page, then the member bar gives way to it"
  },
  "src/api/client.ts document.cookie": {
    value: "the readable CSRF cookie the instance issued",
    classification: "echoed into X-XSRF-TOKEN, and refused by the instance when it does not match",
    test: "src/api/client.test.ts#given an HTTPS host-bound CSRF cookie and a legacy collision, when logging out, then only the host-bound token is used"
  },
  "src/api/client.ts location": {
    value: "the scheme the page was served over",
    classification: "chooses between the host-bound and the unprefixed cookie name",
    test: "src/api/client.test.ts#given an HTTPS host-bound CSRF cookie and a legacy collision, when logging out, then only the host-bound token is used"
  },
  "src/components/AdminNavigation.tsx useLocation": {
    value: "the address the browser is on",
    classification: "marks one destination as current, and never grants one",
    test: "src/components/AdminNavigation.test.tsx#given a page under administration, when the navigation is read, then only that destination is current"
  },
  "src/components/PrimaryNavigation.tsx useLocation": {
    value: "the address the browser is on",
    classification: "marks one destination as current, and never grants one",
    test: "src/components/PrimaryNavigation.test.tsx#given the court plan is open under its other address, when rendered, then it is still the current page"
  },
  "src/i18n.ts localStorage": {
    value: "the language a visitor chose on this device",
    classification: "resolved against the shipped locales, and dropped when it names none",
    test: "src/i18n.test.ts#given a stored language this build does not ship, when the language is read, then the default is used"
  },
  "src/navigation/useFragmentTarget.ts useLocation": {
    value: "the fragment the address carries",
    classification: "compared with one known target id, and moves the focus nowhere else",
    test: "src/navigation/useFragmentTarget.test.tsx#given a fragment naming another element, when the target is ready, then nothing takes the focus"
  },
  "src/theme.ts localStorage": {
    value: "the appearance a visitor chose on this device",
    classification: "compared with the one value that selects light, and dark otherwise",
    test: "src/theme.test.ts#given a stored appearance that is not the light one, when the theme is read, then the page stays dark"
  },
  "src/views/AdminAuditView.tsx useSearchParams": {
    value: "the subject the log is filtered by",
    classification: "passed to the instance, which answers the refusal the view reports",
    test: "src/views/AdminAuditView.test.tsx#given a subject the address names but the instance refuses, when the log is opened, then the refusal is shown instead of an unfiltered log"
  },
  "src/views/AdminPersonView.tsx useLocation": {
    value: "the mark the roster set when it navigated here",
    classification: "compared strictly with true, so nothing else announces a created person",
    test: "src/views/AdminPersonView.test.tsx#given a navigation state that merely resembles the creation mark, when the page opens, then nothing announces a created person"
  },
  "src/views/AdminPersonView.tsx useParams": {
    value: "the person the address names",
    classification: "passed to the instance, which answers the refusal the view reports",
    test: "src/views/AdminPersonView.test.tsx#given an address naming no person the instance knows, when the page opens, then the refusal is shown instead of an empty page"
  },
  "src/views/AdminRosterView.tsx useSearchParams": {
    value: "the membership type the roster is filtered by",
    classification: "passed to the instance, which answers the refusal the view reports",
    test: "src/views/AdminRosterView.test.tsx#given a membership type the address names but the instance refuses, when the roster is opened, then the refusal is shown instead of an unfiltered roster"
  },
  "src/views/ApplicationErrorView.tsx location": {
    value: "no external value",
    classification: "writes a fixed address and reloads, and reads nothing off the location",
    test: "src/views/ApplicationErrorView.test.tsx#given the page may just be stale, when reloading from the error page, then the browser reloads"
  },
  "src/views/facility/AdminBookingCardView.tsx useLocation": {
    value: "the mark the card list set when it navigated here",
    classification: "compared strictly with true, so nothing else announces a created card",
    test: "src/views/facility/AdminBookingCardView.test.tsx#given a navigation state that merely resembles the creation mark, when the page opens, then nothing announces a created card"
  },
  "src/views/facility/AdminBookingCardView.tsx useParams": {
    value: "the card the address names",
    classification: "compared with the cards the instance answered, and named as missing otherwise",
    test: "src/views/facility/AdminBookingCardView.test.tsx#given a card id that names nothing, when the page loads, then it says so instead of offering an empty form"
  }
};

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

const shipped = sourceFiles(join(frontend, "src"))
  .filter((path) => /\.(?:js|jsx|ts|tsx)$/.test(path))
  .filter((path) => !/\.(?:test|spec)\.[^.]+$|\.d\.ts$|setupTests\.ts$/.test(path));

function readsOf(path) {
  const found = new Set();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (/^\s*import\b/.test(line)) continue;
    for (const [name] of line.matchAll(NAMED_READ)) found.add(name);
    if (LOCATION_READ.test(line)) found.add("location");
    LOCATION_READ.lastIndex = 0;
  }
  return found;
}

const inventoried = new Set(shipped.flatMap((path) => {
  const relativePath = relative(frontend, path).split("\\").join("/");
  return [...readsOf(path)].map((read) => `${relativePath} ${read}`);
}));

test("given the shipped browser code, when an external value is read, then the inventory classifies it", () => {
  // given
  assert.ok(shipped.length > 20, "the shipped browser sources were not read");
  assert.ok(inventoried.size >= 10, "no external browser value was found to inventory");

  // when / then
  assert.deepEqual([...inventoried].sort(), Object.keys(BOUNDARIES).sort());
});

test("given an inventoried browser boundary, when its evidence is read, then a behavior test names it", () => {
  // given
  const missing = [];

  // when
  for (const [boundary, { value, classification, test: evidence }] of Object.entries(BOUNDARIES)) {
    assert.ok(value.length > 0 && classification.length > 0, `${boundary} states no classification`);
    const [path, name] = evidence.split("#");
    const file = join(frontend, path);
    if (!existsSync(file) || !readFileSync(file, "utf8").includes(`it("${name}"`)) {
      missing.push(evidence);
    }
  }

  // then
  assert.deepEqual(missing, [],
    "a boundary whose named test does not exist is a classification nothing measures");
});
