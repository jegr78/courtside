package org.courtside.config;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AccessSettingsTest {

    @Test
    void givenTheRangesTheSchemaAllows_whenCheckingThem_thenTheEndsAreInside() {
        // when / then
        assertThat(AccessLeadTime.isValid(0)).isTrue();
        assertThat(AccessLeadTime.isValid(240)).isTrue();
        assertThat(AccessLeadTime.isValid(241)).isFalse();
        assertThat(AccessLagTime.isValid(-1)).isFalse();
        assertThat(AccessLagTime.isValid(240)).isTrue();
        assertThat(AccessCodeLength.isValid(3)).isFalse();
        assertThat(AccessCodeLength.isValid(4)).isTrue();
        assertThat(AccessCodeLength.isValid(8)).isTrue();
        assertThat(AccessCodeLength.isValid(9)).isFalse();
    }

    @Test
    void givenAMinuteCount_whenAskedHowLongItLasts_thenItIsThatManyMinutes() {
        // when / then
        assertThat(new AccessLeadTime(15).toDuration()).isEqualTo(Duration.ofMinutes(15));
        assertThat(new AccessLagTime(30).toDuration()).isEqualTo(Duration.ofMinutes(30));
    }

    @Test
    void whenAskingForALengthOutsideTheRange_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> new AccessCodeLength(9))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("4 to 8");
    }

    @Test
    void givenASixDigitLength_whenCheckingCodes_thenOnlySixDigitsFit() {
        // given
        AccessCodeLength length = new AccessCodeLength(6);

        // when / then
        assertThat(length.fits("123456")).as("six digits fit").isTrue();
        assertThat(length.fits("12345")).as("five digits are too short").isFalse();
        assertThat(length.fits("1234567")).as("seven digits are too long").isFalse();
        assertThat(length.fits("12345a")).as("a letter is not a digit").isFalse();
        assertThat(length.fits("١٢٣٤٥٦")).as("only ASCII digits open a keypad").isFalse();
        assertThat(length.fits(null)).as("no code fits no length").isFalse();
    }
}
