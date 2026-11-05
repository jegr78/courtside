package org.courtside.card;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({MemberTestFixture.class, IdentityTestFixture.class})
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
    @Autowired
    private MemberTestFixture members;
    @Autowired
    private IdentityTestFixture identity;

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
        // given
        UUID admin = account("example.admin", false, Role.ADMIN);

        // when
        List<BookingCard> result = cardService.bookableCards(admin, Set.of(Role.ADMIN));

        // then
        assertThat(result).extracting(BookingCard::getId)
                .containsExactlyInAnyOrder(MEMBER_BOOKING_CARD, TRAINING_CARD, LEAGUE_MATCH_CARD,
                        COURT_CLOSED_CARD);
    }

    @Test
    void givenDirectorsWithoutMembership_whenListingBookableCards_thenOnlyCardsNamingTheirRoleArePresent() {
        // given
        UUID sport = account("john.roe", false, Role.SPORT_DIRECTOR);
        UUID youth = account("mary.major", false, Role.YOUTH_DIRECTOR);

        // when
        List<BookingCard> sportCards = cardService.bookableCards(sport, Set.of(Role.SPORT_DIRECTOR));
        List<BookingCard> youthCards = cardService.bookableCards(youth, Set.of(Role.YOUTH_DIRECTOR));

        // then
        assertThat(sportCards).extracting(BookingCard::getId)
                .containsExactlyInAnyOrder(TRAINING_CARD, LEAGUE_MATCH_CARD);
        assertThat(youthCards).extracting(BookingCard::getId)
                .containsExactlyInAnyOrder(TRAINING_CARD, LEAGUE_MATCH_CARD);
    }

    @Test
    void givenAnOrdinaryMember_whenListingBookableCards_thenOrganizationalCardsAreAbsent() {
        // given
        UUID member = account("jane.doe", true, Role.MEMBER);

        // when
        List<BookingCard> result = cardService.bookableCards(member, Set.of(Role.MEMBER));

        // then
        assertThat(result).extracting(BookingCard::getId)
                .containsExactly(MEMBER_BOOKING_CARD);
    }

    @Test
    void givenAMemberRoleWithoutRunningMembership_whenListingBookableCards_thenNoCardIsOffered() {
        // given
        UUID departed = account("richard.miles", false, Role.MEMBER);

        // when
        List<BookingCard> result = cardService.bookableCards(departed, Set.of(Role.MEMBER));

        // then
        assertThat(result).as("the member card asks for a membership, not for the member role").isEmpty();
    }

    private UUID account(String username, boolean currentMember, Role... roles) {
        UUID personId = members.addPerson("Jane", "Doe", username + "@example.org");
        members.giveAccount(personId, username, Set.of(roles));
        if (currentMember) {
            members.assignMembership(personId, members.createMembershipType("Adult " + username));
        }
        return identity.accountIdOf(personId);
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
