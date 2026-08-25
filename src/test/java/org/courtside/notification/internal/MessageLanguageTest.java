package org.courtside.notification.internal;

import org.junit.jupiter.api.Test;

import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

class MessageLanguageTest {

    @Test
    void givenAnAccountThatNamesItsLanguage_whenChoosingOne_thenTheAccountDecides() {
        // when / then
        assertThat(MessageLanguage.of("en", "de")).isEqualTo(Locale.forLanguageTag("en"));
    }

    @Test
    void givenAnAccountThatNamesNoLanguage_whenChoosingOne_thenTheClubAnswersForIt() {
        // when / then — the column forbids it today, and the message still has to go out in a
        // language somebody reads if that ever changes
        assertThat(MessageLanguage.of(null, "de")).isEqualTo(Locale.forLanguageTag("de"));
        assertThat(MessageLanguage.of("  ", "de")).isEqualTo(Locale.forLanguageTag("de"));
    }

    @Test
    void givenARegionalLanguage_whenChoosingOne_thenItKeepsItsRegion() {
        // when / then
        assertThat(MessageLanguage.of("pt-BR", "de")).isEqualTo(Locale.forLanguageTag("pt-BR"));
    }
}
