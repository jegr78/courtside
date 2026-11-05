package org.courtside.booking.internal;

import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.identity.Role;
import org.courtside.member.MemberService;
import org.courtside.shared.SecurityEventLog;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.courtside.card.testfixture.CardTestFixture.bookingCardAllowing;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CardEligibilityPolicyTest {

    @Mock
    private CardService cards;
    @Mock
    private SecurityEventLog securityEvents;
    @Mock
    private MemberService members;

    private final UUID accountId = UUID.randomUUID();

    @Test
    void givenAnUnknownCard_whenRequiringEligibility_thenTheTypedUnknownFailureIsRaised() {
        // given
        UUID cardId = UUID.randomUUID();
        when(cards.findCard(cardId)).thenReturn(Optional.empty());

        // when / then
        assertThatThrownBy(() -> policy().requireEligible(cardId, accountId, Set.of(Role.MEMBER)))
                .isInstanceOfSatisfying(CardNotBookableException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo("card.unknown"));
    }

    @Test
    void givenAnInactiveCard_whenRequiringEligibility_thenTheTypedInactiveFailureIsRaised() {
        // given
        BookingCard card = bookingCardAllowing(Role.MEMBER);
        card.deactivate();
        when(cards.findCard(card.getId())).thenReturn(Optional.of(card));

        // when / then
        assertThatThrownBy(() -> policy().requireEligible(card.getId(), accountId, Set.of(Role.MEMBER)))
                .isInstanceOfSatisfying(CardNotBookableException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo("card.inactive"));
    }

    @Test
    void givenTheRequiredRole_whenRequiringEligibility_thenTheCardIsReturned() {
        // given
        BookingCard card = bookingCardAllowing(Role.TRAINER);
        when(cards.findCard(card.getId())).thenReturn(Optional.of(card));

        // when
        BookingCard result = policy().requireEligible(card.getId(), accountId, Set.of(Role.TRAINER));

        // then
        assertThat(result).isSameAs(card);
    }

    @Test
    void givenOnlyAnotherRole_whenRequiringEligibility_thenTheRoleFailureIsRaised() {
        // given
        BookingCard card = bookingCardAllowing(Role.TRAINER);
        when(cards.findCard(card.getId())).thenReturn(Optional.of(card));

        // when / then
        assertThatThrownBy(() -> policy().requireEligible(card.getId(), accountId, Set.of(Role.MEMBER)))
                .isInstanceOf(CardRoleRequiredException.class);
        verify(securityEvents).authorizationDeniedForCurrentAccount();
    }

    @Test
    void givenAnAdministrator_whenRequiringEligibility_thenTheRequiredRoleIsBypassed() {
        // given
        BookingCard card = bookingCardAllowing(Role.TRAINER);
        when(cards.findCard(card.getId())).thenReturn(Optional.of(card));

        // when
        BookingCard result = policy().requireEligible(card.getId(), accountId, Set.of(Role.ADMIN));

        // then
        assertThat(result).isSameAs(card);
    }

    @Test
    void givenACardNamingNoRole_whenTheAccountHoldsARunningMembership_thenTheCardIsReturned() {
        // given
        BookingCard card = bookingCardAllowing();
        when(cards.findCard(card.getId())).thenReturn(Optional.of(card));
        when(members.isCurrentMember(accountId)).thenReturn(true);

        // when
        BookingCard result = policy().requireEligible(card.getId(), accountId, Set.of(Role.MEMBER));

        // then
        assertThat(result).isSameAs(card);
    }

    @Test
    void givenACardNamingNoRole_whenTheAccountHoldsOnlyARoleWithoutMembership_thenTheRoleFailureIsRaised() {
        // given
        BookingCard card = bookingCardAllowing();
        when(cards.findCard(card.getId())).thenReturn(Optional.of(card));
        when(members.isCurrentMember(accountId)).thenReturn(false);

        // when / then
        assertThatThrownBy(() -> policy().requireEligible(card.getId(), accountId, Set.of(Role.TRAINER)))
                .isInstanceOf(CardRoleRequiredException.class);
        assertThat(policy().admits(card.getId(), accountId, Set.of(Role.MEMBER)))
                .as("a member role without a running membership").isFalse();
        verify(securityEvents).authorizationDeniedForCurrentAccount();
    }

    @Test
    void givenACardNamingARole_whenTheAccountHoldsIt_thenNoMembershipIsAskedFor() {
        // given
        BookingCard card = bookingCardAllowing(Role.TRAINER);
        when(cards.findCard(card.getId())).thenReturn(Optional.of(card));

        // when
        boolean admitted = policy().admits(card.getId(), accountId, Set.of(Role.TRAINER));

        // then
        assertThat(admitted).isTrue();
        verifyNoInteractions(members);
    }

    private CardEligibilityPolicy policy() {
        return new CardEligibilityPolicy(cards, securityEvents, members);
    }
}
