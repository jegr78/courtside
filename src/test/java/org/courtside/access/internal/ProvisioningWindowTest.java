package org.courtside.access.internal;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.ZoneId;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class ProvisioningWindowTest {

    private static final ZoneId BERLIN = ZoneId.of("Europe/Berlin");
    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");

    @Test
    void givenNoAdvanceWindow_whenTheWindowIsRead_thenItReachesFourteenDaysAhead() {
        // given
        ProvisioningWindow window = new ProvisioningWindow(Optional::empty, () -> BERLIN);

        // when
        Instant end = window.endsAt(NOW);

        // then
        assertThat(end).as("a club without an advance window still has a bounded exposure")
                .isEqualTo(Instant.parse("2026-05-26T10:00:00Z"));
    }

    @Test
    void givenAnAdvanceWindowOfSevenDays_whenTheWindowIsRead_thenItEndsAtTheStartOfTheSeventhClubDay() {
        // given
        ProvisioningWindow window = new ProvisioningWindow(() -> Optional.of(7), () -> BERLIN);

        // when
        Instant end = window.endsAt(NOW);

        // then
        assertThat(end).isEqualTo(Instant.parse("2026-05-18T22:00:00Z"));
    }
}
