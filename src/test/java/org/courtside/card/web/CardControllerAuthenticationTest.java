package org.courtside.card.web;

import org.courtside.card.CardService;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class CardControllerAuthenticationTest {

    @Test
    void givenNoAuthenticationOnTheRequest_whenListingBookingCardsPublicly_thenItReturnsNoCardsRatherThanThrowing() {
        // given — reached directly, with no security filter chain in front to guarantee
        // authentication is present, unlike every MockMvc-driven test in this package
        CardService cards = mock(CardService.class);
        when(cards.bookableCards(Set.of())).thenReturn(List.of());
        CardController controller = new CardController(cards);

        // when / then
        assertThat(controller.bookingCards(null)).isEmpty();
    }
}
