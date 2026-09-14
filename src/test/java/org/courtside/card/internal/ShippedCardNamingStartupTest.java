package org.courtside.card.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.card.CardService;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.shared.ShippedNames;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doReturn;

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

    @MockitoSpyBean
    private ShippedNames names;

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

    @Test
    void givenANameNoRowMayCarry_whenTheInstanceStarts_thenItIsNotReportedAsANameInUse() {
        // given — only a bundle this image ships broken names a row this way, and the row stays
        // recognisable because everyLanguage reads the same bundle the stub would otherwise blank
        doReturn(names.everyLanguage("bookingCard.member"))
                .when(names).everyLanguage("bookingCard.member");
        doReturn(" ").when(names).in("bookingCard.member", "de");

        // when / then
        assertThatThrownBy(() -> naming.run(null))
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
