package org.courtside.notification.internal;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SenderDomainTest {

    @Test
    void givenABareAddress_whenTakingTheSenderDomain_thenItIsTheDomainAfterTheAt() {
        // when / then
        assertThat(MailSettings.senderDomain("noreply@example.org")).isEqualTo("example.org");
    }

    @Test
    void givenTheDisplayFormAMailClientAccepts_whenTakingTheSenderDomain_thenNoAngleBracketSurvives() {
        // when
        String plain = MailSettings.senderDomain("Example Tennis Club <noreply@example.org>");
        String quoted = MailSettings.senderDomain("\"Example Tennis Club\" <noreply@example.org>");

        // then
        assertThat(plain)
                .as("cutting at the first @ leaves the closing bracket, and a Message-ID built from"
                        + " that is malformed on every message the instance sends")
                .isEqualTo("example.org");
        assertThat(quoted).isEqualTo("example.org");
    }

    @Test
    void givenTheDisplayForm_whenBuildingAMessageId_thenItIsTheAddressableFormAMailServerLogs() {
        // when
        String messageId = MailDispatch.newMessageId(
                MailSettings.senderDomain("Example Tennis Club <noreply@example.org>"));

        // then
        assertThat(messageId).matches("<[0-9a-f-]{36}@example\\.org>");
    }

    @Test
    void givenAQuotedLocalPartHoldingAnAt_whenTakingTheSenderDomain_thenTheLastOneSeparatesTheDomain() {
        // when / then — the first @ can sit inside a quoted local part, which is the same shortcut
        // this change exists to remove rather than one to repeat a level down
        assertThat(MailSettings.senderDomain("\"a@b\"@example.org")).isEqualTo("example.org");
    }

    // Everything startup verification lets through has to be something a Message-ID can be built
    // from; a value that parses but names no host would otherwise fail at the first message.
    @Test
    void givenEveryValueVerificationAccepts_whenTakingTheSenderDomain_thenNoneOfThemThrows() {
        // given
        List<String> accepted = List.of("noreply@example.org",
                "Example Tennis Club <noreply@example.org>",
                "\"Example Tennis Club\" <noreply@example.org>",
                "\"a@b\"@example.org",
                "noreply@example.org (Example Tennis Club)");

        // when / then
        for (String value : accepted) {
            assertThat(MailSettings.accepts(value))
                    .as("this test only means something while verification accepts %s", value)
                    .isTrue();
            assertThat(MailSettings.senderDomain(value)).isEqualTo("example.org");
        }
    }

    @Test
    void givenAValueThatNamesNoSingleHost_whenVerifying_thenItIsRefusedBeforeAnyMessageIsBuilt() {
        // when / then
        assertThat(MailSettings.accepts("board: a@example.org;")).isFalse();
        assertThat(MailSettings.accepts("undisclosed:;")).isFalse();
        assertThat(MailSettings.accepts("a@b.org, c@d.org")).isFalse();
    }

    @Test
    void givenAValueStartupVerificationWouldHaveRefused_whenTakingTheSenderDomain_thenItSaysSo() {
        // when / then
        assertThatThrownBy(() -> MailSettings.senderDomain("not a mail address"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_MAIL_FROM");
    }
}
