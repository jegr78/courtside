import { expect, test } from "../../fixtures";
import { activate, openTheApplication, signIn, walks, writeDate } from "../../journey-walking";

test("given a board preparing its annual meeting, when they read how busy the courts were, what the club changed and what it wrote to its members, then each answer is on a page of its own",
  walks("session-and-own-account", "administrative-impact-reporting-and-records"),
  async ({ page, language, journeyService }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await expect(page.getByTestId("admin-shell")).toBeVisible();

    // when — how busy the courts were
    await activate(page.getByTestId("admin-utilisation-link"));
    await expect(page.getByTestId("admin-facility-utilisation-view")).toBeVisible();
    await writeDate(page.getByTestId("utilisation-from"), journeyService.visualDate);
    await writeDate(page.getByTestId("utilisation-to"), journeyService.visualDate);
    await activate(page.getByTestId("utilisation-read"));

    // then
    await expect(page.getByTestId("utilisation-period")).toBeVisible();
    await expect(page.locator('[data-testid^="utilisation-row-"]').first()).toBeVisible();

    // when — what the club changed
    await activate(page.getByTestId("admin-audit-link"));

    // then
    await expect(page.getByTestId("admin-audit-view")).toBeVisible();
    await expect(page.getByTestId("audit-row").or(page.getByTestId("audit-empty")).first()).toBeVisible();

    // when — and what it wrote to its members
    await activate(page.getByTestId("admin-messages-link"));

    // then
    await expect(page.getByTestId("admin-messages-view")).toBeVisible();
    await expect(page.getByTestId("message-row").or(page.getByTestId("messages-empty")).first()).toBeVisible();
  });
