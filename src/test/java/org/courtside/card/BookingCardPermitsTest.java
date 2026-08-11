package org.courtside.card;

import org.courtside.identity.Role;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class BookingCardPermitsTest {

    private static BookingCard cardAllowing(Role... allowedRoles) {
        return new BookingCard("Training", "#34584A", Set.of(allowedRoles),
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
}
