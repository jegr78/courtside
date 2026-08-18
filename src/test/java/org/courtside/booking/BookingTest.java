package org.courtside.booking;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class BookingTest {

    private static final UUID CARD = UUID.randomUUID();
    private static final UUID BOOKER_ACCOUNT = UUID.randomUUID();
    private static final Instant CREATED_AT = Instant.parse("2026-05-12T10:00:00Z");

    @Test
    void givenAWithdrawalFromTheMiddle_whenAFurtherParticipantIsAdded_thenNoPositionRepeats() {
        // given
        Booking booking = new Booking(CARD, BOOKER_ACCOUNT, null, CREATED_AT);
        UUID mary = UUID.randomUUID();
        booking.addParticipant(ParticipantSpec.member(UUID.randomUUID()));
        booking.addParticipant(ParticipantSpec.member(mary));
        booking.addParticipant(ParticipantSpec.member(UUID.randomUUID()));

        // when
        booking.withdrawParticipant(mary);
        booking.addParticipant(ParticipantSpec.member(UUID.randomUUID()));

        // then
        assertThat(booking.getParticipants()).extracting(BookingParticipant::getPosition)
                .as("(booking_id, position) is unique, and a withdrawal leaves a hole the next"
                        + " participant must not fall into")
                .containsExactly(1, 3, 4);
    }

    @Test
    void givenABookingWithAGuest_whenAWithdrawalNamesNobody_thenNothingIsRemoved() {
        // given
        Booking booking = new Booking(CARD, BOOKER_ACCOUNT, null, CREATED_AT);
        booking.addParticipant(ParticipantSpec.member(UUID.randomUUID()));
        booking.addParticipant(ParticipantSpec.guest("John Roe"));

        // when
        boolean withdrawn = booking.withdrawParticipant(null);

        // then
        assertThat(withdrawn).isFalse();
        assertThat(booking.getParticipants())
                .as("a guest carries no person id, so a null must not match every one of them")
                .hasSize(2);
    }
}
