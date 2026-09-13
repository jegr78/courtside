import { expect, test } from "../../fixtures";
import { credentialIn, messageTo } from "../../mailbox";
import { activate, openTheApplication, walks, writeInto } from "../../journey-walking";

test("given a member who cannot remember their password on a Sunday evening, when they ask for a new one and redeem the code the club mails them, then they are back in without anybody on the board being asked",
  walks("session-and-own-account"), async ({ page, language, journeyService }) => {
    // given
    await openTheApplication(page, language);
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await activate(page.getByTestId("sign-in-link"));
    await expect(page.getByTestId("login-view")).toBeVisible();

    // when — they ask, naming only themselves
    await activate(page.getByTestId("forgotten-credentials-link"));
    await expect(page.getByTestId("account-recovery-view")).toBeVisible();
    await writeInto(page.getByTestId("recovery-username"), "doe.jane");
    await activate(page.getByTestId("recovery-password-submit"));

    // then — the club says the same thing it would say about a name nobody holds
    await expect(page.getByTestId("recovery-sent")).toBeVisible();

    // when — and the code that reached their mailbox is the way back
    const mailed = await messageTo(journeyService.mailboxURL, "jane.doe@example.org");
    await writeInto(page.getByTestId("recovery-code"), credentialIn(mailed, "Code:"));
    await writeInto(page.getByTestId("recovery-new-password"), "the-one-they-chose-themselves");
    await activate(page.getByTestId("recovery-redeem-submit"));

    // then
    await expect(page.getByTestId("recovery-sent")).toBeVisible();
    await activate(page.getByTestId("recovery-back-to-login"));
    await expect(page.getByTestId("login-view")).toBeVisible();
    await writeInto(page.getByTestId("username"), "doe.jane");
    await writeInto(page.getByTestId("password"), "the-one-they-chose-themselves");
    await activate(page.getByTestId("login-submit"));
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
  });
