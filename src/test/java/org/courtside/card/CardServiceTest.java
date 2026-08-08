package org.courtside.card;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class CardServiceTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID BALL_MACHINE =
            UUID.fromString("55555555-5555-5555-5555-555555555555");

    @Autowired
    private CardService cardService;

    @Test
    void whenListingActiveCards_thenTheFourSeededCardsAreReturned() {
        // when
        var result = cardService.activeCards();

        // then
        assertThat(result).extracting(BookingCard::getLabel)
                .containsExactlyInAnyOrder(
                        "Member booking", "Training", "League match", "Court closed");
    }

    @Test
    void givenAnAdmin_whenListingBookableCards_thenEveryActiveCardIsVisibleRegardlessOfRequiredRole() {
        // when
        List<BookingCard> result = cardService.bookableCards(Set.of(Role.ADMIN));

        // then
        assertThat(result).extracting(BookingCard::getLabel)
                .containsExactlyInAnyOrder(
                        "Member booking", "Training", "League match", "Court closed");
    }

    @Test
    void givenACallerHoldingSeveralRoles_whenListingBookableCards_thenACardGatedBehindAnyHeldRoleIsPresent() {
        // when
        List<BookingCard> result = cardService.bookableCards(Set.of(Role.MEMBER, Role.TRAINER));

        // then
        assertThat(result).extracting(BookingCard::getLabel)
                .containsExactlyInAnyOrder("Member booking", "Training", "League match");
    }

    @Test
    void givenTheSeededMemberCard_whenLoadingIt_thenItAllowsSinglesAndDoubles() {
        // when
        BookingCard card = cardService.findCard(MEMBER_BOOKING_CARD).orElseThrow();

        // then
        assertThat(card.getAllowedPlayerCounts()).containsExactly((short) 2, (short) 4);
        assertThat(card.tracksPlayers()).isTrue();
        assertThat(card.allows(2)).isTrue();
        assertThat(card.allows(4)).isTrue();
        assertThat(card.allows(3)).isFalse();
    }

    @Test
    void givenTheSeededTrainingCard_whenLoadingIt_thenItTracksNoPlayers() {
        // when
        BookingCard card = cardService.findCard(TRAINING_CARD).orElseThrow();

        // then
        assertThat(card.getAllowedPlayerCounts()).isEmpty();
        assertThat(card.tracksPlayers()).isFalse();
        assertThat(card.allows(2)).isFalse();
    }

    @Test
    void whenLoadingActiveParticipantCards_thenBallMachineAndPartnerWantedAreReturned() {
        // when
        List<ParticipantCard> participantCards = cardService.activeParticipantCards();

        // then
        assertThat(participantCards).extracting(ParticipantCard::getLabel)
                .containsExactly("Ball machine", "Looking for a partner");
    }

    @Test
    void givenTheBallMachineCard_whenLoadingItById_thenItIsActive() {
        // when
        ParticipantCard card = cardService.findParticipantCard(BALL_MACHINE).orElseThrow();

        // then
        assertThat(card.getLabel()).isEqualTo("Ball machine");
        assertThat(card.isActive()).isTrue();
    }
}
