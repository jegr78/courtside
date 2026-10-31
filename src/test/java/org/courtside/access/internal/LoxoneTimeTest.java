package org.courtside.access.internal;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;

class LoxoneTimeTest {

    private static final ZoneId CLUB = ZoneId.of("Europe/Berlin");

    @Test
    void givenTheEpochInTheClubZone_whenConverted_thenItIsSecondZeroAndADayLaterIsADayOfSeconds() {
        // when
        long epoch = LoxoneTime.from(Instant.parse("2008-12-31T23:00:00Z"), CLUB);
        long dayLater = LoxoneTime.from(Instant.parse("2009-01-01T23:00:00Z"), CLUB);

        // then
        assertThat(epoch).as("2009-01-01 00:00 wall time in the club zone").isZero();
        assertThat(dayLater).isEqualTo(86_400);
    }

    @Test
    void givenAWindowAcrossTheSpringChange_whenConverted_thenItCountsWallTimeAndRoundTrips() {
        // given
        Instant from = Instant.parse("2026-03-29T00:30:00Z");
        Instant until = Instant.parse("2026-03-29T01:30:00Z");

        // when
        long loxoneFrom = LoxoneTime.from(from, CLUB);
        long loxoneUntil = LoxoneTime.until(until, CLUB);

        // then
        assertThat(loxoneUntil - loxoneFrom).as("01:30 CET to 03:30 CEST is two hours of wall time").isEqualTo(7_200);
        assertThat(LoxoneTime.instant(loxoneFrom, CLUB)).isEqualTo(from);
        assertThat(LoxoneTime.instant(loxoneUntil, CLUB)).isEqualTo(until);
    }

    @Test
    void givenAWindowAcrossTheAutumnChange_whenConverted_thenItCountsWallTimeAndRoundTrips() {
        // given
        Instant from = Instant.parse("2026-10-24T23:30:00Z");
        Instant until = Instant.parse("2026-10-25T02:30:00Z");

        // when
        long loxoneFrom = LoxoneTime.from(from, CLUB);
        long loxoneUntil = LoxoneTime.until(until, CLUB);

        // then
        assertThat(loxoneUntil - loxoneFrom).as("01:30 CEST to 03:30 CET is two hours of wall time").isEqualTo(7_200);
        assertThat(LoxoneTime.instant(loxoneFrom, CLUB)).isEqualTo(from);
        assertThat(LoxoneTime.instant(loxoneUntil, CLUB)).isEqualTo(until);
    }

    @Test
    void givenFractionalSeconds_whenConverted_thenTheStartRoundsDownAndTheEndRoundsUp() {
        // given
        long whole = LoxoneTime.from(Instant.parse("2026-06-01T10:00:00Z"), CLUB);

        // when
        long from = LoxoneTime.from(Instant.parse("2026-06-01T10:00:00.900Z"), CLUB);
        long until = LoxoneTime.until(Instant.parse("2026-06-01T10:00:00.100Z"), CLUB);
        long exactUntil = LoxoneTime.until(Instant.parse("2026-06-01T10:00:00Z"), CLUB);

        // then
        assertThat(whole).as("12:00 CEST on 2026-06-01").isEqualTo(549_547_200);
        assertThat(from).as("a start never opens later than asked").isEqualTo(whole);
        assertThat(until).as("an end never closes earlier than asked").isEqualTo(whole + 1);
        assertThat(exactUntil).as("a whole second stays as it is").isEqualTo(whole);
    }
}
