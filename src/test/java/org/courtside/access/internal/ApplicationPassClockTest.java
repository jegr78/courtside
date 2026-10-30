package org.courtside.access.internal;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class ApplicationPassClockTest {

    @Test
    void givenTheApplicationClock_whenThePassReadsTheTime_thenItAnswersThatClocksInstant() {
        // given
        Instant fixed = Instant.parse("2026-05-12T10:00:00Z");
        PassClock clock = new ApplicationPassClock(Clock.fixed(fixed, ZoneOffset.UTC));

        // when
        Instant now = clock.now();

        // then
        assertThat(now).as("a fixed instant in a disposable run is the pass's time too").isEqualTo(fixed);
    }
}
