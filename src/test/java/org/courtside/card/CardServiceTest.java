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
    private static final UUID LEAGUE_MATCH_CARD =
            UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID COURT_CLOSED_CARD =
            UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID BALL_MACHINE =
            UUID.fromString("55555555-5555-5555-5555-555555555555");
    private static final UUID PARTNER_WANTED =
            UUID.fromString("66666666-6666-6666-6666-666666666666");

    @Autowired
    private CardService cardService;

    @Test
    void whenListingActiveCards_thenTheFourSeededCardsAreReturned() {
        // when
        var result = cardService.activeCards();

        // then
        assertThat(result).extracting(BookingCard::getId)
                .containsExactlyInAnyOrder(MEMBER_BOOKING_CARD, TRAINING_CARD, LEAGUE_MATCH_CARD,
                        COURT_CLOSED_CARD);
    }

    @Test
    void givenAnAdmin_whenListingBookableCards_thenEveryActiveCardIsVisibleRegardlessOfRequiredRole() {
        // when
        List<BookingCard> result = cardService.bookableCards(Set.of(Role.ADMIN));

        // then
        assertThat(result).extracting(BookingCard::getId)
                .containsExactlyInAnyOrder(MEMBER_BOOKING_CARD, TRAINING_CARD, LEAGUE_MATCH_CARD,
                        COURT_CLOSED_CARD);
    }

    @Test
    void givenDirectors_whenListingBookableCards_thenCardsGatedBehindAnyHeldRoleArePresent() {
        // when
        List<BookingCard> sport = cardService.bookableCards(Set.of(Role.SPORT_DIRECTOR));
        List<BookingCard> youth = cardService.bookableCards(Set.of(Role.YOUTH_DIRECTOR));

        // then
        assertThat(sport).extracting(BookingCard::getId)
                .containsExactlyInAnyOrder(MEMBER_BOOKING_CARD, TRAINING_CARD, LEAGUE_MATCH_CARD);
        assertThat(youth).extracting(BookingCard::getId)
                .containsExactlyInAnyOrder(MEMBER_BOOKING_CARD, TRAINING_CARD, LEAGUE_MATCH_CARD);
    }

    @Test
    void givenAnOrdinaryMember_whenListingBookableCards_thenOrganizationalCardsAreAbsent() {
        // when
        List<BookingCard> result = cardService.bookableCards(Set.of(Role.MEMBER));

        // then
        assertThat(result).extracting(BookingCard::getId)
                .containsExactly(MEMBER_BOOKING_CARD);
    }

    @Test
    void givenTheSeededMemberCard_whenLoadingIt_thenItAllowsTwoAndFourPlayers() {
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
    void whenLoadingTheSeededCards_thenOnlyOfficerRolesManageThemAndTheMemberCardNamesNone() {
        // when
        List<BookingCard> result = cardService.activeCards();

        // then
        assertThat(managingRolesOf(result, MEMBER_BOOKING_CARD)).isEmpty();
        assertThat(managingRolesOf(result, TRAINING_CARD)).containsExactlyInAnyOrder(
                Role.TRAINER, Role.SPORT_DIRECTOR, Role.YOUTH_DIRECTOR);
        assertThat(managingRolesOf(result, LEAGUE_MATCH_CARD)).containsExactlyInAnyOrder(
                Role.SPORT_DIRECTOR, Role.YOUTH_DIRECTOR);
        assertThat(managingRolesOf(result, COURT_CLOSED_CARD)).containsExactly(Role.GROUNDSKEEPER);
    }

    private static Set<Role> managingRolesOf(List<BookingCard> cards, UUID cardId) {
        return cards.stream()
                .filter(card -> card.getId().equals(cardId))
                .findFirst().orElseThrow()
                .getManagingRoles();
    }

    @Test
    void whenLoadingActiveParticipantCards_thenBallMachineAndPartnerWantedAreReturned() {
        // when
        List<ParticipantCard> participantCards = cardService.activeParticipantCards();

        // then
        assertThat(participantCards).extracting(ParticipantCard::getId)
                .containsExactly(BALL_MACHINE, PARTNER_WANTED);
    }

    @Test
    void givenTheBallMachineCard_whenLoadingItById_thenItIsActive() {
        // when
        ParticipantCard card = cardService.findParticipantCard(BALL_MACHINE).orElseThrow();

        // then
        assertThat(card.getId()).isEqualTo(BALL_MACHINE);
        assertThat(card.isActive()).isTrue();
    }
}
