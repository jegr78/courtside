package org.courtside.card;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import(ConfigTestFixture.class)
class ShippedCardNamingTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID LEAGUE_MATCH =
            UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID COURT_CLOSED =
            UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID BALL_MACHINE =
            UUID.fromString("55555555-5555-5555-5555-555555555555");

    @Autowired
    private CardService cards;

    @Autowired
    private ConfigTestFixture configuration;

    @Test
    void whenTheInstanceHasStarted_thenItsCardsCarryTheLanguageTheClubIsShippedWith() {
        // when / then — the migrations seed English, and 'de' is the language a fresh instance has
        assertThat(labelOf(MEMBER_BOOKING)).isEqualTo("Mitgliederbuchung");
        assertThat(labelOf(LEAGUE_MATCH)).isEqualTo("Punktspiel");
        assertThat(labelOf(COURT_CLOSED)).isEqualTo("Platz gesperrt");
        assertThat(participantLabelOf(BALL_MACHINE)).isEqualTo("Ballmaschine");
    }

    @Test
    void givenAClubThatChangesItsLanguage_whenItIsSaved_thenItsCardsFollowWithoutARestart() {
        // when
        configuration.speak("en");

        // then
        assertThat(labelOf(MEMBER_BOOKING)).isEqualTo("Member booking");
        assertThat(participantLabelOf(BALL_MACHINE)).isEqualTo("Ball machine");
    }

    @Test
    void givenACardTheClubNamedItself_whenTheClubChangesItsLanguage_thenTheClubsOwnNameStands() {
        // given
        cards.changeCard(LEAGUE_MATCH, "Medenspiel", "#3A4A5C", Set.of(), Set.of(),
                new short[0], false, false, false);

        // when
        configuration.speak("en");

        // then
        assertThat(labelOf(LEAGUE_MATCH)).isEqualTo("Medenspiel");
        assertThat(labelOf(MEMBER_BOOKING)).isEqualTo("Member booking");
    }

    private String labelOf(UUID cardId) {
        return cards.requireCard(cardId).getLabel();
    }

    private String participantLabelOf(UUID cardId) {
        return cards.requireParticipantCard(cardId).getLabel();
    }
}
