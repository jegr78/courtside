package org.courtside.notification.internal;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.Locale;
import java.util.ResourceBundle;

import static org.assertj.core.api.Assertions.assertThat;

class MessagesAreaMailWordingTest {

    @ParameterizedTest
    @CsvSource(delimiter = ';', value = {
            "de ; Öffne Nachrichten ; (?iuU).*\\b(öffne|unter|in) (deine |deinen )?benachrichtigungen\\b.*",
            "en ; Open Messages ; (?iuU).*\\b(open|in|under) (your )?notifications\\b.*"})
    void givenAShippedMailLanguage_whenAMailPointsToTheMessagesArea_thenItNamesTheAreaAsTheNavigationDoes(
            String language, String pointer, String formerPointer) {
        // given
        ResourceBundle mail = ResourceBundle.getBundle("mail", Locale.forLanguageTag(language),
                ResourceBundle.Control.getNoFallbackControl(ResourceBundle.Control.FORMAT_PROPERTIES));

        // when
        String offer = mail.getString("waitlist.offer.body");

        // then
        assertThat(offer).as("the waitlist offer sends the member to the messages area").contains(pointer);
        assertThat(mail.keySet()).as("no mail sends the member to the area by its former name")
                .noneMatch(key -> mail.getString(key).replace('\n', ' ').matches(formerPointer));
    }
}
