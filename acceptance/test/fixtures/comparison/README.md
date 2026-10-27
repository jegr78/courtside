# native comparison fixtures

The named `comparison-masks.spec.ts` self-test generated these viewport and full-page PNGs and their comparison records through `capture`. Chromium desktop and Firefox use pixel density 1. The 320px Chromium phone uses density 3 and the 375px WebKit phone uses density 2. All captures load the repository's pinned Geist Mono font before recording evidence.

The previous and current pages differ only in a formatted date, time, unread count, version, generated name suffix and native and localized date/time inputs. The page loads the application stylesheet and includes
checked checkbox/radio controls. Static labels and the raw ISO timestamp stay unchanged. `tools/acceptance-inheritance.test.mjs` passes these exact producer bytes through contact sheet generation, pixel comparison and report rendering.

To regenerate them, run only `comparison-masks.spec.ts` in the pinned browser image with projects `chromium`, `chromium-comparison-dense`, `webkit-comparison` and `firefox-comparison`. Copy each project's `previous` and `current` viewport/full-page PNGs and `.comparison.json` files from its test output into the matching fixture directory. Keep image bytes and metadata together. Comparison records use protocol version 3.

The `comparison-rejections.spec.ts` Chromium cases generate the `rejections/` pairs. They preserve
changed adjacent static text, overlays, ordinary welcome text, date formatting, ancestor backgrounds
generated pseudo-element badges and numeric and date-shaped booking-card labels, and other static numeric report copy, configured statistics labels and date-shaped text without temporal semantics.
Explicit temporal statistics buckets remain maskable. Usage metric values stay maskable. Regenerate those pairs with the same capture producer and
copy each case's prefixed files to its matching directory without modifying either bytes or metadata.
