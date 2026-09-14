package org.courtside.card.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.card.CardService;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;

@Import(ConfigTestFixture.class)
class ShippedCardNamingStartupTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Autowired
    private ShippedCardNaming naming;

    @Autowired
    private CardService cards;

    @Autowired
    private ConfigTestFixture configuration;

    @Test
    void givenAClubUsingTheNameAShippedCardWouldTake_whenTheInstanceStarts_thenItStartsAnyway() {
        // given — the club speaks English and already uses the name its member card would take
        cards.createCard("Member booking", "#123456", Set.of(), Set.of(),
                new short[0], false, false, false);
        configuration.speak("en");

        // when / then — a runner that throws closes the context, and a club could not start again
        assertThatNoException().isThrownBy(() -> naming.run(null));
        assertThat(cards.requireCard(MEMBER_BOOKING).getLabel()).isEqualTo("Mitgliederbuchung");
    }
}
