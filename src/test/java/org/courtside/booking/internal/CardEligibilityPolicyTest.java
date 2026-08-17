package org.courtside.booking.internal;

import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.identity.Role;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CardEligibilityPolicyTest {

    @Mock
    private CardService cards;

    @Test
    void givenAnUnknownCard_whenRequiringEligibility_thenTheTypedUnknownFailureIsRaised() {
        // given
        UUID cardId = UUID.randomUUID();
        when(cards.findCard(cardId)).thenReturn(Optional.empty());

        // when / then
        assertThatThrownBy(() -> policy().requireEligible(cardId, Set.of(Role.MEMBER)))
                .isInstanceOfSatisfying(CardNotBookableException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo("card.unknown"));
    }

    @Test
    void givenAnInactiveCard_whenRequiringEligibility_thenTheTypedInactiveFailureIsRaised() {
        // given
        BookingCard card = cardAllowing(Role.MEMBER);
        card.deactivate();
        when(cards.findCard(card.getId())).thenReturn(Optional.of(card));

        // when / then
        assertThatThrownBy(() -> policy().requireEligible(card.getId(), Set.of(Role.MEMBER)))
                .isInstanceOfSatisfying(CardNotBookableException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo("card.inactive"));
    }

    @Test
    void givenTheRequiredRole_whenRequiringEligibility_thenTheCardIsReturned() {
        // given
        BookingCard card = cardAllowing(Role.TRAINER);
        when(cards.findCard(card.getId())).thenReturn(Optional.of(card));

        // when
        BookingCard result = policy().requireEligible(card.getId(), Set.of(Role.TRAINER));

        // then
        assertThat(result).isSameAs(card);
    }

    @Test
    void givenOnlyAnotherRole_whenRequiringEligibility_thenTheRoleFailureIsRaised() {
        // given
        BookingCard card = cardAllowing(Role.TRAINER);
        when(cards.findCard(card.getId())).thenReturn(Optional.of(card));

        // when / then
        assertThatThrownBy(() -> policy().requireEligible(card.getId(), Set.of(Role.MEMBER)))
                .isInstanceOf(CardRoleRequiredException.class);
    }

    @Test
    void givenAnAdministrator_whenRequiringEligibility_thenTheRequiredRoleIsBypassed() {
        // given
        BookingCard card = cardAllowing(Role.TRAINER);
        when(cards.findCard(card.getId())).thenReturn(Optional.of(card));

        // when
        BookingCard result = policy().requireEligible(card.getId(), Set.of(Role.ADMIN));

        // then
        assertThat(result).isSameAs(card);
    }

    private CardEligibilityPolicy policy() {
        return new CardEligibilityPolicy(cards);
    }

    private BookingCard cardAllowing(Role... roles) {
        return new BookingCard("Training", "#34584A", Set.of(roles), Set.of(),
                new short[]{}, false, false, false);
    }
}
