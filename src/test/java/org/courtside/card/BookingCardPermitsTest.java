package org.courtside.card;

import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.identity.Role;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class BookingCardPermitsTest {

    private static BookingCard cardAllowing(Role... allowedRoles) {
        return new BookingCard("Training", "#34584A", Set.of(allowedRoles), Set.of(),
                new short[]{}, false, false, false, false, true);
    }

    @Test
    void givenACardRequiringNoRole_whenTheCallerHoldsARunningMembership_thenTheCallerIsPermitted() {
        // given
        BookingCard card = cardAllowing();

        // when / then
        assertThat(card.permits(Set.of(), true, false)).isTrue();
        assertThat(card.permits(Set.of(Role.MEMBER), true, false)).isTrue();
    }

    @Test
    void givenACardRequiringNoRole_whenTheCallerHoldsNoRunningMembership_thenNoRoleStandsInForIt() {
        // given
        BookingCard card = cardAllowing();

        // when / then
        assertThat(card.permits(Set.of(Role.MEMBER), false, false)).as("a stale member role").isFalse();
        assertThat(card.permits(Set.of(Role.TRAINER, Role.GROUNDSKEEPER), false, false)).isFalse();
    }

    @Test
    void givenACardRequiringARole_whenTheCallerHoldsIt_thenTheCallerIsPermitted() {
        // given
        BookingCard card = cardAllowing(Role.TRAINER, Role.TREASURER);

        // when / then
        assertThat(card.permits(Set.of(Role.TRAINER), false, false)).isTrue();
        assertThat(card.permits(Set.of(Role.TREASURER), false, false)).isTrue();
    }

    @Test
    void givenACardRequiringARole_whenTheCallerHoldsItAmongOthers_thenTheCallerIsPermitted() {
        // given
        BookingCard card = cardAllowing(Role.TRAINER, Role.TREASURER);

        // when / then
        assertThat(card.permits(Set.of(Role.MEMBER, Role.TRAINER), false, false)).isTrue();
    }

    @Test
    void givenACardRequiringARole_whenTheCallerHoldsOnlyOtherRoles_thenTheCallerIsNotPermitted() {
        // given
        BookingCard card = cardAllowing(Role.TRAINER);

        // when / then
        assertThat(card.permits(Set.of(Role.MEMBER, Role.TREASURER), true, false)).isFalse();
    }

    @Test
    void givenACardRequiringARole_whenTheCallerHoldsNone_thenTheCallerIsNotPermitted() {
        // given
        BookingCard card = cardAllowing(Role.TRAINER);

        // when / then
        assertThat(card.permits(Set.of(), false, false)).isFalse();
    }

    @Test
    void givenACardRequiringARole_whenTheCallerIsAdmin_thenPermitsStillAnswersForTheCardAlone() {
        // given
        BookingCard card = cardAllowing(Role.TRAINER);

        // when / then
        assertThat(card.permits(Set.of(Role.ADMIN), false, false)).isFalse();
    }

    @Test
    void givenACardNamingNoManagingRole_whenAskedWhoManagesIt_thenNobodyDoes() {
        // given
        BookingCard card = cardManagedBy();

        // when / then
        assertThat(card.permitsManagement(Set.of())).isFalse();
        assertThat(card.permitsManagement(Set.of(Role.TRAINER))).isFalse();
    }

    @Test
    void givenACardManagedByDirectors_whenAskedWhoManagesIt_thenAnyOfThemDoes() {
        // given
        BookingCard card = cardManagedBy(Role.SPORT_DIRECTOR, Role.YOUTH_DIRECTOR);

        // when / then
        assertThat(card.permitsManagement(Set.of(Role.SPORT_DIRECTOR))).isTrue();
        assertThat(card.permitsManagement(Set.of(Role.YOUTH_DIRECTOR))).isTrue();
        assertThat(card.permitsManagement(Set.of(Role.TRAINER))).isFalse();
    }

    @Test
    void givenACardBookableByATrainer_whenItNamesNoManagingRole_thenBookingAccessDoesNotManage() {
        // given
        BookingCard card = new BookingCard("Training", "#34584A", Set.of(Role.TRAINER), Set.of(),
                new short[]{}, false, false, false, false, true);

        // when / then
        assertThat(card.permits(Set.of(Role.TRAINER), false, false)).isTrue();
        assertThat(card.permitsManagement(Set.of(Role.TRAINER))).isFalse();
    }

    private static BookingCard cardManagedBy(Role... managingRoles) {
        return new BookingCard("Training", "#34584A", Set.of(), Set.of(managingRoles),
                new short[]{}, false, false, false, false, true);
    }

    @Test
    void givenACardNamingTheExternalRole_whenTheClubAdmitsExternalBookingsOrNot_thenOnlyTheSwitchOpensIt() {
        // given
        BookingCard card = CardTestFixture.bookingCardAllowing(Role.EXTERNAL);

        // when / then
        assertThat(card.permits(Set.of(Role.EXTERNAL), false, true)).isTrue();
        assertThat(card.permits(Set.of(Role.EXTERNAL), false, false)).as("the switch is off").isFalse();
        assertThat(CardTestFixture.bookingCardAllowing(Role.EXTERNAL, Role.MEMBER)
                .permits(Set.of(Role.MEMBER), true, false)).as("members keep the card while the switch is off").isTrue();
    }

    @Test
    void givenAnExternalAccount_whenAskedForItsManagementRoles_thenItHoldsNone() {
        // when
        Set<Role> roles = BookingCard.managementRoles(Set.of(Role.EXTERNAL, Role.MEMBER, Role.TRAINER));

        // then
        assertThat(roles).as("neither MEMBER nor EXTERNAL ever manages a card").containsExactly(Role.TRAINER);
    }
}
