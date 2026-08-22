package org.courtside.notification.internal;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MailPropertiesTest {

    @Test
    void whenTheSettingsArePrinted_thenTheRelayPasswordIsNotAmongThem() {
        // given
        MailProperties properties = new MailProperties("mail.example.org", 587,
                "no-reply@example.org", "board@example.org", "courtside@example.org",
                "s3cret-relay-password", true);

        // when
        String printed = properties.toString();

        // then — a record prints every component, and a bean-dump or a failed binding prints a record
        assertThat(printed).doesNotContain("s3cret-relay-password").contains("password=set");
        assertThat(printed).contains("mail.example.org").contains("587")
                .contains("no-reply@example.org").contains("board@example.org")
                .contains("courtside@example.org").contains("trustRelayCertificate=true");
    }

    @Test
    void givenARelayThatNeedsNoAccount_whenTheSettingsArePrinted_thenTheySaySo() {
        // given
        MailProperties properties = new MailProperties("mail.example.org", 587,
                "no-reply@example.org", "board@example.org", null, null, false);

        // when / then
        assertThat(properties.toString()).contains("password=unset");
    }
}
