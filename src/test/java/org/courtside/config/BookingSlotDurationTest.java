package org.courtside.config;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.LocalTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BookingSlotDurationTest {

    @Test
    void givenAnInvalidDuration_whenCreatingTheValue_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> new BookingSlotDuration(0))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void givenAValidDuration_whenCheckingTimesAndDurations_thenWholeSlotsAreRecognised() {
        // given
        BookingSlotDuration slotDuration = new BookingSlotDuration(90);

        // when / then
        assertThat(slotDuration.isAligned(LocalTime.of(1, 30))).isTrue();
        assertThat(slotDuration.isAligned(LocalTime.of(1, 0))).isFalse();
        assertThat(slotDuration.containsWholeSlots(Duration.ofMinutes(180))).isTrue();
        assertThat(slotDuration.containsWholeSlots(Duration.ofMinutes(60))).isFalse();
    }

    @Test
    void givenFractionalSeconds_whenCheckingAlignment_thenTheyAreRejected() {
        // given
        BookingSlotDuration slotDuration = new BookingSlotDuration(30);

        // when / then
        assertThat(slotDuration.isAligned(LocalTime.of(8, 0, 0, 1))).isFalse();
        assertThat(slotDuration.containsWholeSlots(Duration.ofMinutes(30).plusNanos(1))).isFalse();
    }
}
