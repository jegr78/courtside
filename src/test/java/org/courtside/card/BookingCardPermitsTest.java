package org.courtside.card;

import org.courtside.identity.Role;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class BookingCardPermitsTest {

    private static BookingCard cardAllowing(Role... allowedRoles) {
        return new BookingCard("Training", "#34584A", Set.of(allowedRoles), Set.of(),
                new short[]{}, false, false, false);
    }

    @Test
    void givenACardRequiringNoRole_whenAskedWhoItPermits_thenEveryCallerIsPermitted() {
        // given
        BookingCard card = cardAllowing();

        // when / then
        assertThat(card.permits(Set.of())).isTrue();
        assertThat(card.permits(Set.of(Role.MEMBER))).isTrue();
    }

    @Test
    void givenACardRequiringARole_whenTheCallerHoldsIt_thenTheCallerIsPermitted() {
        // given
        BookingCard card = cardAllowing(Role.TRAINER, Role.TREASURER);

        // when / then
        assertThat(card.permits(Set.of(Role.TRAINER))).isTrue();
        assertThat(card.permits(Set.of(Role.TREASURER))).isTrue();
    }

    @Test
    void givenACardRequiringARole_whenTheCallerHoldsItAmongOthers_thenTheCallerIsPermitted() {
        // given
        BookingCard card = cardAllowing(Role.TRAINER, Role.TREASURER);

        // when / then
        assertThat(card.permits(Set.of(Role.MEMBER, Role.TRAINER))).isTrue();
    }

    @Test
    void givenACardRequiringARole_whenTheCallerHoldsOnlyOtherRoles_thenTheCallerIsNotPermitted() {
        // given
        BookingCard card = cardAllowing(Role.TRAINER);

        // when / then
        assertThat(card.permits(Set.of(Role.MEMBER, Role.TREASURER))).isFalse();
    }

    @Test
    void givenACardRequiringARole_whenTheCallerHoldsNone_thenTheCallerIsNotPermitted() {
        // given
        BookingCard card = cardAllowing(Role.TRAINER);

        // when / then
        assertThat(card.permits(Set.of())).isFalse();
    }

    @Test
    void givenACardRequiringARole_whenTheCallerIsAdmin_thenPermitsStillAnswersForTheCardAlone() {
        // given
        BookingCard card = cardAllowing(Role.TRAINER);

        // when / then
        assertThat(card.permits(Set.of(Role.ADMIN))).isFalse();
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
                new short[]{}, false, false, false);

        // when / then
        assertThat(card.permits(Set.of(Role.TRAINER))).isTrue();
        assertThat(card.permitsManagement(Set.of(Role.TRAINER))).isFalse();
    }

    private static BookingCard cardManagedBy(Role... managingRoles) {
        return new BookingCard("Training", "#34584A", Set.of(), Set.of(managingRoles),
                new short[]{}, false, false, false);
    }
}
