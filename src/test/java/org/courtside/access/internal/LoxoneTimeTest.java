package org.courtside.access.internal;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class LoxoneTimeTest {

    private static final Instant EPOCH = Instant.parse("2009-01-01T00:00:00Z");

    @Test
    void givenTheValueAMiniserverShowedAs2000Cet_whenConverted_thenItIs1900Utc() {
        // when
        Instant shown = LoxoneTime.instant(562_705_200L);

        // then
        assertThat(shown).as("the Loxone app showed 562705200 as 31 October 2026, 20:00 CET")
                .isEqualTo(Instant.parse("2026-10-31T19:00:00Z"));
        assertThat(LoxoneTime.from(shown)).isEqualTo(562_705_200L);
    }

    @Test
    void givenAWinterAndASummerEvening_whenConverted_thenEachCountsUtcSecondsSince2009() {
        // given
        Instant winter = Instant.parse("2026-10-31T18:00:00Z");
        Instant summer = Instant.parse("2026-06-01T16:00:00Z");

        // when
        long winterSeconds = LoxoneTime.from(winter);
        long summerSeconds = LoxoneTime.from(summer);

        // then
        assertThat(winterSeconds).as("19:00 CET").isEqualTo(Duration.between(EPOCH, winter).getSeconds());
        assertThat(summerSeconds).as("18:00 CEST").isEqualTo(Duration.between(EPOCH, summer).getSeconds());
        assertThat(LoxoneTime.from(EPOCH)).isZero();
    }

    @Test
    void givenAWindowAcrossTheAutumnChange_whenConverted_thenItCountsElapsedSecondsAndRoundTrips() {
        // given
        Instant from = Instant.parse("2026-10-24T23:30:00Z");
        Instant until = Instant.parse("2026-10-25T02:30:00Z");

        // when
        long loxoneFrom = LoxoneTime.from(from);
        long loxoneUntil = LoxoneTime.until(until);

        // then
        assertThat(loxoneUntil - loxoneFrom).as("three hours pass, whatever the wall clock does").isEqualTo(10_800);
        assertThat(LoxoneTime.instant(loxoneFrom)).isEqualTo(from);
        assertThat(LoxoneTime.instant(loxoneUntil)).isEqualTo(until);
    }

    @Test
    void givenFractionalSeconds_whenConverted_thenTheStartRoundsDownAndTheEndRoundsUp() {
        // given
        long whole = LoxoneTime.from(Instant.parse("2026-06-01T10:00:00Z"));

        // when
        long from = LoxoneTime.from(Instant.parse("2026-06-01T10:00:00.900Z"));
        long until = LoxoneTime.until(Instant.parse("2026-06-01T10:00:00.100Z"));
        long exactUntil = LoxoneTime.until(Instant.parse("2026-06-01T10:00:00Z"));

        // then
        assertThat(from).as("a start never opens later than asked").isEqualTo(whole);
        assertThat(until).as("an end never closes earlier than asked").isEqualTo(whole + 1);
        assertThat(exactUntil).as("a whole second stays as it is").isEqualTo(whole);
    }
}
