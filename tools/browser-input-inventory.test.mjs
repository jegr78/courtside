import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = join(repository, "frontend");

// A query string this application builds is a request it sends, so new URLSearchParams({...}) in
// api/client.ts carries no external value and is deliberately not one of these.
const NAMED_READ = /\b(localStorage|sessionStorage|useParams|useSearchParams|useLocation|matchMedia|document\.cookie|document\.referrer|window\.name|history\.state)\b/g;
const LOCATION_READ = /\b(?:window\.)?location\.(?:protocol|href|search|hash|pathname|origin|assign|reload)/g;

const BOUNDARIES = {
  "src/App.tsx useLocation": {
    value: "the address the browser is on, and the returnTo target in its query",
    classification: "sign-in follows the returnTo target only when returnTarget accepts it as a same-origin path, otherwise the start page; the rest of the address only picks the shell, never a right",
    test: "src/App.test.tsx#given a sign-in whose target could leave this origin, when the member is signed in, then the start page is shown"
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
  "src/booking/finePointer.ts matchMedia": {
    value: "whether the device reports a fine pointer",
    classification: "decides whether the booking dialog mentions dragging across slots, and never which durations it offers",
    test: "src/views/BookingDialog.test.tsx#given only touch, when the dialog opens, then it says nothing about dragging"
  },
  "src/components/AdminNavigation.tsx matchMedia": {
    value: "the width the browser reports",
    classification: "decides whether the destinations start folded, and never which ones exist",
    test: "src/components/AdminNavigation.test.tsx#given a window narrower than the breakpoint, when the navigation is shown, then it stays folded"
  },
  "src/components/AdminNavigation.tsx useLocation": {
    value: "the address the browser is on",
    classification: "marks one destination as current, and never grants one",
    test: "src/components/AdminNavigation.test.tsx#given a page under administration, when the navigation is read, then only that destination is current"
  },
  "src/components/AdminShell.tsx useLocation": {
    value: "the path the browser is on",
    classification: "triggers alignment of an already rendered current navigation entry inside its own scroller, and never grants a destination or reads data",
    test: "src/components/AdminShell.test.tsx#given a desktop navigation with an active entry below its frame, when the window resizes, then the frame begins and ends on whole entries"
  },
  "src/components/PrimaryNavigation.tsx useLocation": {
    value: "the address the browser is on",
    classification: "marks one destination as current, and never grants one",
    test: "src/components/PrimaryNavigation.test.tsx#given the court plan is open under its other address, when rendered, then it is still the current page"
  },
  "src/views/facility/OccupancyKeySection.tsx location": {
    value: "the origin the board's browser is on",
    classification: "prefixes the occupancy address shown beside a newly created key, as text to copy, and is never sent anywhere",
    test: "src/views/facility/AdminAccessPointsView.test.tsx#given no occupancy key, when the board creates one, then the key and the ready URL are shown once"
  },
  "src/i18n.ts localStorage": {
    value: "the language a visitor chose on this device",
    classification: "resolved against the shipped locales, and dropped when it names none",
    test: "src/i18n.test.ts#given a stored language this build does not ship, when the language is read, then the default is used"
  },
  "src/navigation/recoverStaleDocument.ts location": {
    value: "no external value",
    classification: "reloads the document once a newer worker took over, and reads nothing off the location",
    test: "src/navigation/recoverStaleDocument.test.ts#given a newer version waiting, when recovering, then it takes over before the one reload"
  },
  "src/navigation/PageScroll.tsx useLocation": {
    value: "the path the address carries",
    classification: "compared with the path shown before, and only decides whether the page starts at its top",
    test: "src/router.test.tsx#given the application's route, when another destination opens, then the page is scrolled to its top"
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
  "src/views/AdminStatisticsView.tsx useSearchParams": {
    value: "the period the statistics are read for",
    classification: "taken only as two real dates with the start not after the end, and the default period otherwise; the instance checks the period again",
    test: "src/views/AdminStatisticsView.test.tsx#given an address whose period ends before it starts, when the statistics open, then the default period is read instead"
  },
  "src/views/configuration/AdminRuleSetsView.tsx useSearchParams": {
    value: "the rule set the booking rules open on",
    classification: "compared with the ids of the rule sets the instance returned, and the first one otherwise",
    test: "src/views/configuration/AdminRuleSetsView.test.tsx#given a rule set the address names but the club does not have, when the rule sets open, then the first one is chosen"
  },
  "src/views/AdminMessagesView.tsx useSearchParams": {
    value: "whether the log opens on refused and failed messages",
    classification: "compared strictly with true, so any other value opens the whole log",
    test: "src/views/AdminMessagesView.test.tsx#given an unsettled value in the address that is not true, when the log is opened, then every message is read"
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
  "src/views/AdminRosterView.tsx matchMedia": {
    value: "the width the browser reports",
    classification: "decides whether the hidden column headings take focus, and never which order is offered",
    test: "src/views/AdminRosterView.test.tsx#given a phone, when the roster loads, then the hidden column sort buttons leave the tab order"
  },
  "src/views/AdminRosterView.tsx useSearchParams": {
    value: "the membership type and the access state the roster is filtered by",
    classification: "the type is passed to the instance, which answers the refusal the view reports; the access state is compared with the filters the roster offers and dropped otherwise",
    test: "src/views/AdminRosterView.test.tsx#given an access filter the address names but the roster does not offer, when the roster is opened, then it reads everybody"
  },
  "src/views/AdminUsageView.tsx useSearchParams": {
    value: "the period the usage report is read for",
    classification: "taken only as two real dates with the start not after the end, and the default period otherwise; the instance checks the period again",
    test: "src/views/AdminUsageView.test.tsx#given an address whose period ends before it starts, when the page opens, then the default period is read instead"
  },
  "src/views/ApplicationErrorView.tsx location": {
    value: "no external value",
    classification: "assigns the sign-in address currentSignInPath built or reloads, and reads nothing off the location itself",
    test: "src/views/ApplicationErrorView.test.tsx#given a view faulted on a booking, when signing out from the error page, then sign-in returns to that booking"
  },
  "src/navigation/returnTarget.ts location": {
    value: "the path, query and fragment the browser is on",
    classification: "becomes the returnTo target only when returnTarget accepts it as a same-origin path, and is dropped otherwise",
    test: "src/navigation/returnTarget.test.ts#given the browser on a booking, when sign-in is required, then the booking travels as the target"
  },
  "src/views/LoginView.tsx useLocation": {
    value: "the returnTo target in the address",
    classification: "passed on to account recovery only when returnTarget accepts it, and dropped otherwise",
    test: "src/views/LoginView.test.tsx#given a sign-in that carries a target, when the member opens the forgotten-credentials link, then the target travels with it"
  },
  "src/views/AccountRecoveryView.tsx useLocation": {
    value: "the returnTo target in the address",
    classification: "passed back to sign-in only when returnTarget accepts it, and dropped otherwise",
    test: "src/views/AccountRecoveryView.test.tsx#given recovery reached with a target, when the member goes back to sign in, then the target travels with them"
  },
  "src/views/MyBookingsView.tsx location": {
    value: "the fragment a notification link put on the address",
    classification: "names an element id the page looks up among the bookings it already shows, so an unknown id moves nothing and reaches no data",
    test: "src/views/MyBookingsView.test.tsx#given a link to a booking the lists do not hold, when the bookings have loaded, then nothing moves and nothing fails"
  },
  "src/views/WaitlistSection.tsx location": {
    value: "the fragment a waitlist offer in the notification centre put on the address",
    classification: "names an element id the section looks up among the member's own entries, and an unknown id only focuses the section, so it reaches no data",
    test: "src/views/WaitlistSection.test.tsx#given a link to an entry the list does not hold, when the entries have loaded, then the section takes the focus and nothing fails"
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

// src/test holds the harness the suite imports and the bundle never does.
const shipped = sourceFiles(join(frontend, "src"))
  .filter((path) => /\.(?:js|jsx|ts|tsx)$/.test(path))
  .filter((path) => !/\.(?:test|spec)\.[^.]+$|\.d\.ts$|setupTests\.ts$/.test(path))
  .filter((path) => !/(?:^|[\\/])src[\\/]test[\\/]/.test(path));

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
    const declares = existsSync(file) && readFileSync(file, "utf8").split("\n")
      .some((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line) && line.includes(`it("${name}"`));
    if (!declares) {
      missing.push(evidence);
    }
  }

  // then
  assert.deepEqual(missing, [],
    "a boundary whose named test does not exist is a classification nothing measures");
});
