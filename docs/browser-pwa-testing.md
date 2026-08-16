# Browser and PWA qualification

Courtside treats Chromium and WebKit as required desktop engines. The merge gate runs the full
Chromium suite, the WebKit accessibility suite and core member and administration journeys in
WebKit. The scheduled stability workflow adds Firefox, iPhone/Safari emulation and Android/Chrome
emulation. Emulation exercises layout, touch input and browser-engine behaviour; it is not evidence
for operating-system integration or a physical device.

The application shell is available offline after installation. Booking, account and administration
operations require the network. Workbox uses `NetworkOnly` for every `/api/` request, and the PWA
journey inspects Cache Storage after authenticated activity and offline reloads. A German and an
English offline launch must show the connection state, reconnect without mixed assets and retain no
personal API response. Logout plus Back and Forward must not reveal an authenticated view.

Vite registers updates in prompt mode. A waiting worker stays inactive until the localized update
control is accepted, then activates and reloads the application as one asset version. Additive API
changes remain compatible with an already open client. A breaking published API change follows the
compatibility policy and requires an explicit client reload path before release; it cannot be
qualified by silently mixing incompatible assets.

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
