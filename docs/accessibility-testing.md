# Accessibility testing

Courtside treats WCAG 2.2 AA as a functional release requirement. The required browser suite runs
automated axe checks for the public court plan, authentication, password change, member bookings,
booking dialogs and administration in German and English. Chromium covers all browser journeys;
Chromium is the blocking automated WCAG rule gate. WebKit runs blocking core compatibility
journeys. The WebKit plus axe combination runs in the scheduled reliability path and is not a
merge gate. Keyboard, dialog focus, reflow, reduced-motion and forced-colour checks complement
axe because a scanner cannot decide whether a workflow is usable.

## Manual release check

Run this checklist for 1.0, each major UI change and any change to navigation, forms or dialogs.
Record the date, tested commit or image digest, browser and operating-system versions, assistive
technology versions, locale, result and linked defect for every failure.

- Complete sign-in, initial password change, booking, cancellation, series move and the main
  administration forms with a keyboard only. Confirm a visible focus indicator and logical order.
- With NVDA and Firefox on Windows, complete the member journey and verify headings, landmarks,
  field instructions, validation errors, status announcements and dialog names.
- With VoiceOver and Safari on macOS or iOS, repeat the public plan and booking-dialog journey.
- At 200% and 400% browser zoom, verify that content reflows without two-dimensional scrolling,
  clipped controls or obscured focus, except for the court-plan data table where horizontal table
  scrolling remains available from the keyboard. The automated suite covers the 400% case only as its
  320 CSS pixel equivalent, by narrowing the viewport; real browser zoom stays a manual check,
  because scaling the page in script leaves the media queries at the wide breakpoint and therefore
  never reflows at all.
- Enable increased contrast or forced colours and verify that availability, ownership, errors,
  disabled controls and focus never depend on colour alone.
- Enable reduced motion and verify that no transition or animation impedes navigation.
- On a touch device, verify target size, orientation, text resizing and that the software keyboard
  does not cover the active field, validation message or submit action.

Automated success is evidence for detectable rules only. A release record is incomplete until the
manual checks are attached or a time-bounded exception names the affected criterion, owner and
review date according to the quality strategy.
