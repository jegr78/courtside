package org.courtside.card.web;

import org.courtside.card.CardService;
import org.courtside.identity.CurrentUser;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class CardControllerAuthenticationTest {

    @Test
    void givenNoAuthenticatedAccount_whenListingBookingCardsPublicly_thenItReturnsNoCardsRatherThanThrowing() {
        // given
        CardService cards = mock(CardService.class);
        CurrentUser currentUser = mock(CurrentUser.class);
        when(currentUser.account()).thenReturn(Optional.empty());
        when(cards.bookableCards(Set.of())).thenReturn(List.of());
        CardController controller = new CardController(cards, currentUser);

        // when / then
        assertThat(controller.listBookableCards().getBody()).isEmpty();
    }
}
