package org.courtside.notification.internal;

import org.junit.jupiter.api.Test;

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
    void givenAValueStartupVerificationWouldHaveRefused_whenTakingTheSenderDomain_thenItSaysSo() {
        // when / then
        assertThatThrownBy(() -> MailSettings.senderDomain("not a mail address"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_MAIL_FROM");
    }
}
