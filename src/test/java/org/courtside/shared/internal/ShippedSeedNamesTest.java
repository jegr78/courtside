package org.courtside.shared.internal;

import org.courtside.shared.ShippedNames;
import org.courtside.shared.SupportedLanguages;
import org.junit.jupiter.api.Test;

import java.util.Locale;
import java.util.ResourceBundle;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ShippedSeedNamesTest {

    private final ShippedNames names = new ShippedSeedNames(new Shipped(Set.of("de", "en")));

    @Test
    void givenAClubThatSpeaksTheTranslatedLanguage_whenNamingAShippedRow_thenItReadsInThatLanguage() {
        // when / then
        assertThat(names.in("bookingCard.member", "de")).isEqualTo("Mitgliederbuchung");
        assertThat(names.in("membershipType.active", "de")).isEqualTo("Aktiv");
    }

    @Test
    void givenAClubThatSpeaksTheBaseLanguage_whenNamingAShippedRow_thenItReadsInTheBaseLanguage() {
        // when / then
        assertThat(names.in("bookingCard.member", "en")).isEqualTo("Member booking");
        assertThat(names.in("participantCard.lookingForAPartner", "en"))
                .isEqualTo("Looking for a partner");
    }

    @Test
    void givenALanguageTheImageDoesNotShip_whenNamingAShippedRow_thenTheBaseLanguageAnswers() {
        // given — a host whose own language the image does happen to ship
        Locale host = Locale.getDefault();
        Locale.setDefault(Locale.GERMANY);
        ResourceBundle.clearCache();

        // when / then — never the language of the container, always the one the club chose
        try {
            assertThat(names.in("bookingCard.courtClosed", "fr")).isEqualTo("Court closed");
        } finally {
            Locale.setDefault(host);
            ResourceBundle.clearCache();
        }
    }

    @Test
    void whenAskingWhatAShippedRowIsCalledEverywhere_thenEveryShippedLanguageIsNamed() {
        // when / then — this is what recognises a row a club has never renamed
        assertThat(names.everyLanguage("bookingCard.leagueMatch"))
                .containsExactlyInAnyOrder("League match", "Punktspiel");
        assertThat(names.everyLanguage("bookingCard.training")).containsExactly("Training");
    }

    @Test
    void givenAKeyTheBundleDoesNotCarry_whenNamingIt_thenItSaysWhichKeyIsMissing() {
        // when / then
        assertThatThrownBy(() -> names.in("bookingCard.clubEvening", "de"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("bookingCard.clubEvening");
    }

    @Test
    void givenNoLanguageAtAll_whenNamingAShippedRow_thenItSaysTheCallerHasABug() {
        // when / then
        assertThatThrownBy(() -> names.in("bookingCard.member", null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("language");
    }

    private record Shipped(Set<String> tags) implements SupportedLanguages {

        @Override
        public boolean supports(String tag) {
            return tags.contains(tag);
        }
    }
}
