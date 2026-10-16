package org.courtside.facility;

import org.courtside.AbstractIntegrationTest;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.modulith.events.core.EventSerializer;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class AvailabilityChangeSerializationTest extends AbstractIntegrationTest {

    @Autowired
    private EventSerializer serializer;

    @Test
    void givenANewSeason_whenItsPublicationIsStoredAndRead_thenItComesBackUnchanged() {
        // given
        AvailabilityChange.PeriodStored stored = new AvailabilityChange.PeriodStored(null, new OpeningPeriod(
                UUID.randomUUID(), OpeningPeriod.Kind.SEASON, "Winter", LocalDate.of(2026, 11, 1),
                LocalDate.of(2027, 2, 28), Map.of(DayOfWeek.MONDAY,
                        new OpeningWindow(LocalTime.of(9, 0), LocalTime.of(17, 0)))));

        // when
        Object read = serializer.deserialize(serializer.serialize(stored), AvailabilityChange.PeriodStored.class);

        // then
        assertThat(read).as("a publication the registry cannot read back is lost on resubmission")
                .isEqualTo(stored);
    }

    @Test
    void givenAWidenedClosure_whenItsPublicationIsStoredAndRead_thenBothVersionsComeBack() {
        // given
        UUID closureId = UUID.randomUUID();
        UUID courtId = UUID.randomUUID();
        AvailabilityChange.ClosureStored stored = new AvailabilityChange.ClosureStored(
                new CourtClosure(closureId, courtId, "Nets", LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 2)),
                new CourtClosure(closureId, courtId, "Nets", LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 5)));

        // when
        Object read = serializer.deserialize(serializer.serialize(stored), AvailabilityChange.ClosureStored.class);

        // then
        assertThat(read).as("a publication the registry cannot read back is lost on resubmission")
                .isEqualTo(stored);
    }
}
