package org.courtside.rules;

import org.junit.jupiter.api.Test;

import java.time.LocalTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BookingWindowTest {

    @Test
    void givenMinutesAfterMidnight_whenBuildingAWindow_thenTheyBecomeTimesOfDay() {
        // when
        BookingWindow window = BookingWindow.ofMinutesOfDay(540, 1439);

        // then
        assertThat(window).isEqualTo(new BookingWindow(LocalTime.of(9, 0), LocalTime.of(23, 59)));
    }

    @Test
    void givenAnEndThatIsTheStart_whenBuildingAWindow_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> new BookingWindow(LocalTime.NOON, LocalTime.NOON))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("A booking window ends after it starts");
    }
}
