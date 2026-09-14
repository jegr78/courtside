# Browser and PWA qualification

Courtside treats Chromium and WebKit as required desktop engines. The merge gate runs Chromium
core and accessibility projects plus core member, administration and installed-PWA journeys in
WebKit. Chromium owns the blocking automated WCAG rule scan. The WebKit plus axe combination runs
in the scheduled reliability path and is not a merge gate. The scheduled stability workflow adds
Firefox, iPhone/Safari emulation and Android/Chrome emulation. Emulation exercises layout, touch
input and browser-engine behaviour; it is not evidence for operating-system integration or a
physical device.

The application shell is available offline after installation. Booking, account and administration
operations require the network. Workbox uses `NetworkOnly` for every `/api/` request, and the PWA
journey inspects Cache Storage after authenticated activity and offline reloads. A German and an
English offline launch must show the connection state, reconnect without mixed assets and retain no
personal API response. Logout plus Back and Forward must not reveal an authenticated view.

The Chromium security journey stores a harmless inert markup payload in every current text shape
that reaches the rendered PWA: club and court names, booking and participant-card labels, rule-set
names, roster names, managed-booking notes and guest names. It then observes the public, member,
administrative and managed-appointment projections. Execution markers must remain untouched, the
payload must not enter console output, and only the locale preference may appear in Web Storage.
IndexedDB remains a closed empty inventory; adding a database requires an explicit security review.
Retained evidence contains storage key names, IndexedDB names, cached request paths, cookie
attributes, console event types and normalized CSP events, never storage or cookie values, response
bodies or credentials. Security journeys disable Playwright traces and screenshots. The build
uploads only the two evidence documents after each has passed its closed JSON Schema.

The shipped browser source uses no legacy plugin elements or APIs such as `applet`, `embed`,
`object`, ActiveX, `navigator.plugins` or `document.write`. A source policy closes that boundary;
Chromium and WebKit journeys separately prove that the maintained browser engines can execute the
current application.

The shared browser world runs Chromium and WebKit through its trusted TLS proxy. Both engines must
accept `__Host-SESSION` and `__Host-XSRF-TOKEN`, complete login and a mutation, clear the cookies on
logout and recover from expiry. The periodic Firefox header smoke remains on the plain origin
because its remote process has a separate certificate store. Backend tests, local development and
the restore and upgrade smokes prove the explicit unprefixed HTTP cookie policy. Evidence retains
cookie names and `Secure`, `HttpOnly`, `SameSite` and path attributes without retaining values.

The installed-PWA compatibility journey uses the trusted TLS origin in Chromium and WebKit. It
proves service-worker registration, sign-in, an authenticated mutation and logout. Chromium alone
runs the offline navigation and worker-update lifecycle because WebKit's remote browser process
does not complete the cached offline navigation reliably enough for a merge gate.

A separate CSP probe creates a blocked inline script and requires an attributable
`securitypolicyviolation` event. The Chromium and WebKit smoke also inserts a hostile `<base>` and
proves that `base-uri 'none'` keeps a relative link on the Courtside origin. Chromium runs the
complete projection, storage, cache and CSP suite. Firefox runs the header smoke in the periodic
browser qualification. The existing service-worker transition journey also rechecks the CSP and
API-cache boundary after activating the updated worker.
`security/browser-rendering-contexts.json` is the maintained inventory of club-controlled browser
contexts. Its policy test requires every entry to have a matching journey assertion.

Vite registers updates in prompt mode. A waiting worker stays inactive until the localized update
control is accepted, then activates and reloads the application as one asset version. Additive API
changes remain compatible with an already open client. A breaking published API change follows the
compatibility policy and requires an explicit client reload path before release; it cannot be
qualified by silently mixing incompatible assets.

## The journey catalogue

Nineteen journeys walk a club's way through the product, one per case: installing the instance,
importing a member list, booking as a member, a trainer, a sport director and a groundskeeper,
looking after an account, and reading what the club did. Ten of them are things somebody does at
the club with a phone in their hand and run on the desktop and on both emulated phones; the nine a
board does at a desk run on the desktop alone. Every journey runs in German and in English, which
is 78 runs, executed serially.

A journey may only open the application, activate something a person can see, and type into
something a person can type into. `journey-policy.ts` refuses navigation by address, `fill`,
`click`, `tap`, evaluating script, raising events, forcing a click, its own requests and reaching
the database, and `journey-policy.test.ts` proves both directions of each rule against a corpus.
Two steps happen outside the browser and are narrow: a journey hands the file picker a path to a
fixture file in the repository, and the mailbox helper reads the one-time password an instance
sends. Building the uploaded file in the test and fetching the mailbox from a journey both stay
refused.

A date and a time field are the one place a journey hands a value over rather than typing it. Their
segments are read in the order the browser prints them, and that order comes from the browser's own
locale and not the product's, so digits typed into them measure which build the container holds
rather than what the club did.

Each journey declares the production workflow or workflows it walks as a Playwright annotation.
`journey-coverage.test.ts` reads that declaration out of `--list --reporter=json`, so the guard
sees what Playwright resolves rather than a list kept beside it, and it fails when a workflow in
`security/production-workflows.json` is walked by nothing. `build-and-source-discovery` is the one
exemption: its two operations are the build identifier and the web manifest, which no club performs
as a task.

The merge gate runs the catalogue once, on the desktop, in German, recording nothing. The full
matrix runs only behind `COURTSIDE_JOURNEY_RUN`, and the way to produce it is:

```bash
node tools/journey-run.mjs
```

That writes video, trace and screenshots per journey into `build/journeys/<timestamp>/`, which is
git-ignored and carries the moment of the run so a later one cannot overwrite the one a release
cites. It generates `index.md` from the run's own report, journey, device, language, outcome,
duration and a link to each artefact, and prints the absolute path of both.

## Physical-device evidence

Before 1.0, every major UI release and every release that changes the PWA lifecycle, run this short
smoke on one current iOS/Safari device and one current Android/Chrome device:

1. Record the candidate commit, image digest, device model, operating-system version, browser
   version and UTC timestamp.
2. Install Courtside from the browser and launch it from the home screen.
3. Sign in with a synthetic account, open personal bookings, open and close a booking dialog and
   sign out.
4. Disable networking, relaunch the installed application and verify the localized offline state.
5. Restore networking and verify that the court plan returns without a second sign-in or an update
   loop.
6. Install the preceding UI, start the candidate backend and verify the compatible core journey.
7. Publish a changed candidate UI, accept its update prompt and verify one coherent build identity.
8. Inspect browser storage and confirm that Cache Storage contains no `/api/` response.

Attach the completed record to the release and link it from the release checklist. Use placeholder
identities only. Screenshots must not contain cookies, credentials, personal bookings or real club
data. A missing device, browser version, image digest, failed step or absent link leaves browser
qualification incomplete; it is not converted into success by repeating the run.
