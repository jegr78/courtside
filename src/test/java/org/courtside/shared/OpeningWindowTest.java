package org.courtside.shared;

import org.junit.jupiter.api.Test;

import java.time.LocalTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OpeningWindowTest {

    private static final LocalTime EIGHT = LocalTime.of(8, 0);
    private static final LocalTime TEN = LocalTime.of(10, 0);

    @Test
    void givenAnOpeningTimeWithoutAClosingTime_whenBuildingTheWindow_thenItIsRejectedWithACode() {
        // when / then
        assertThatThrownBy(() -> new OpeningWindow(EIGHT, null))
                .isInstanceOf(InvalidOpeningWindowException.class)
                .extracting("code")
                .isEqualTo("openingWindow.incomplete");
    }

    @Test
    void givenAClosingTimeWithoutAnOpeningTime_whenBuildingTheWindow_thenItIsRejectedWithACode() {
        // when / then
        assertThatThrownBy(() -> new OpeningWindow(null, TEN))
                .isInstanceOf(InvalidOpeningWindowException.class)
                .extracting("code")
                .isEqualTo("openingWindow.incomplete");
    }

    @Test
    void givenAClosingTimeBeforeTheOpeningTime_whenBuildingTheWindow_thenItIsRejectedWithACode() {
        // when / then
        assertThatThrownBy(() -> new OpeningWindow(TEN, EIGHT))
                .isInstanceOf(InvalidOpeningWindowException.class)
                .extracting("code")
                .isEqualTo("openingWindow.closesBeforeItOpens");
    }

    @Test
    void givenTheSameOpeningAndClosingTime_whenBuildingTheWindow_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> new OpeningWindow(EIGHT, EIGHT))
                .isInstanceOf(InvalidOpeningWindowException.class)
                .extracting("code")
                .isEqualTo("openingWindow.closesBeforeItOpens");
    }

    @Test
    void givenBothTimesAbsent_whenBuildingFromNullableTimes_thenTheDayIsClosedRatherThanInvalid() {
        // when
        var result = OpeningWindow.ofNullable(null, null);

        // then
        assertThat(result).isEmpty();
    }

    @Test
    void givenOnlyOneTimePresent_whenBuildingFromNullableTimes_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> OpeningWindow.ofNullable(EIGHT, null))
                .isInstanceOf(InvalidOpeningWindowException.class);
    }

    @Test
    void whenRequiringAWindowThatIsNotThere_thenATypedExceptionIsThrownRatherThanANullPointer() {
        // when / then
        assertThatThrownBy(() -> OpeningWindow.required(null))
                .isInstanceOf(InvalidOpeningWindowException.class)
                .extracting("code")
                .isEqualTo("openingWindow.missing");
    }

    @Test
    void givenAWindow_whenAskingWhetherItCoversAnInterval_thenItsOwnBoundsAreInside() {
        // given
        OpeningWindow window = new OpeningWindow(EIGHT, TEN);

        // when / then
        assertThat(window.covers(EIGHT, TEN)).isTrue();
        assertThat(window.covers(LocalTime.of(7, 59), TEN)).isFalse();
        assertThat(window.covers(EIGHT, LocalTime.of(10, 1))).isFalse();
    }
}
