package org.courtside.notification.internal;

import org.courtside.notification.MessageKind;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class MessageTemplateCatalogTest {

    @Test
    void whenTheShippedWordingOfEveryMessageIsChecked_thenNothingIsRefused() {
        for (MessageKind kind : MessageKind.values()) {
            for (String language : MessageTemplateCatalog.LANGUAGES) {
                // when
                List<MessageTemplateCatalog.Violation> found =
                        MessageTemplateCatalog.check(kind, MessageTemplateCatalog.shipped(kind, language));

                // then
                assertThat(found).as("the shipped %s wording of %s", language, kind).isEmpty();
            }
        }
    }

    @Test
    void whenThePlaceholdersAreListed_thenEveryMessageOffersTheInstanceLink() {
        for (MessageKind kind : MessageKind.values()) {
            // when
            List<String> offered = List.copyOf(MessageTemplateCatalog.placeholders(kind));

            // then
            assertThat(offered).as("%s", kind).contains("instanceLink");
        }
    }

    @Test
    void givenAFirstPasswordWithoutThePassword_whenChecked_thenTheMissingPlaceholderIsNamed() {
        // given
        MessageText text = new MessageText("{clubName}: welcome", "Hello {firstName}, your username is {username}.");

        // when
        List<MessageTemplateCatalog.Violation> found =
                MessageTemplateCatalog.check(MessageKind.CREDENTIALS_NEW_ACCOUNT, text);

        // then
        assertThat(found).containsExactly(
                new MessageTemplateCatalog.Violation("messageTemplate.placeholder.missing", "credential"));
    }

    @Test
    void givenAPlaceholderTheMessageDoesNotFill_whenChecked_thenItIsNamedAsUnknown() {
        // given
        MessageText text = new MessageText("{clubName}: booked", "Hello {nickname}, see you on {day}.");

        // when
        List<MessageTemplateCatalog.Violation> found = MessageTemplateCatalog.check(MessageKind.BOOKING_CONFIRMED, text);

        // then
        assertThat(found).containsExactly(
                new MessageTemplateCatalog.Violation("messageTemplate.placeholder.unknown", "nickname"));
    }

    @Test
    void givenTheResetCodeInTheSubject_whenChecked_thenTheSecretIsKeptOutOfIt() {
        // given
        MessageText text = new MessageText("Your code {resetCode}", "Use {resetCode} for {username}.");

        // when
        List<MessageTemplateCatalog.Violation> found =
                MessageTemplateCatalog.check(MessageKind.ACCOUNT_PASSWORD_RESET_CODE, text);

        // then
        assertThat(found).containsExactly(
                new MessageTemplateCatalog.Violation("messageTemplate.placeholder.secretInSubject", "resetCode"));
    }

    @Test
    void givenALineBreakInTheSubject_whenChecked_thenTheSubjectIsRefused() {
        // given
        MessageText text = new MessageText("Booked\nBcc: someone@example.org", "See you on {day}.");

        // when
        List<MessageTemplateCatalog.Violation> found = MessageTemplateCatalog.check(MessageKind.BOOKING_CONFIRMED, text);

        // then
        assertThat(found).containsExactly(new MessageTemplateCatalog.Violation("messageTemplate.subject.lineBreak", null));
    }

    @Test
    void givenALinkAndTheInstanceLinkInAFirstPassword_whenChecked_thenTheClubsWordingStands() {
        // given
        MessageText text = new MessageText("{clubName}: your account",
                "Sign in at {instanceLink} or https://club.example.org with {username} and {credential}.");

        // when
        List<MessageTemplateCatalog.Violation> found =
                MessageTemplateCatalog.check(MessageKind.CREDENTIALS_NEW_ACCOUNT, text);

        // then
        assertThat(found).as("a link is the club's to place").isEmpty();
    }
}
