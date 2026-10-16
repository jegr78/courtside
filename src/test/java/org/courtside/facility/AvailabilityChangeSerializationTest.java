package org.courtside.facility;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.internal.WeeklyOpeningHours;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.modulith.events.core.EventSerializer;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

@RecordApplicationEvents
@Import(FacilityTestFixture.class)
class AvailabilityChangeSerializationTest extends AbstractIntegrationTest {

    private static final String BOARD_NOTE = "Roof leak, contractor booked";

    @Autowired
    private EventSerializer serializer;

    @Autowired
    private FacilityService facility;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private ApplicationEvents events;

    @Test
    void givenAWidenedClosure_whenItsPublicationIsStoredAndRead_thenBothVersionsComeBackWithoutTheBoardsNote() {
        // given
        var court = facilityFixture.createCourt(1, "Court 1");
        var closure = facility.createCourtClosure(court, BOARD_NOTE, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 2));
        facility.changeCourtClosure(closure.id(), court, BOARD_NOTE, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 5));
        AvailabilityChange.ClosureStored widened = events.stream(AvailabilityChange.ClosureStored.class).toList().getLast();

        // when
        Object stored = serializer.serialize(widened);
        Object read = serializer.deserialize(stored, AvailabilityChange.ClosureStored.class);

        // then
        assertThat(stored.toString()).as("event_publication keeps a failed delivery, so it holds no text members never see")
                .doesNotContain(BOARD_NOTE);
        assertThat(read).as("a publication the registry cannot read back is lost on resubmission").isEqualTo(widened);
    }

    @Test
    void givenANewSeason_whenItsPublicationIsStoredAndRead_thenItComesBackWithoutItsName() {
        // given
        facility.createOpeningPeriod(OpeningPeriod.Kind.SEASON, BOARD_NOTE, LocalDate.of(2026, 11, 1),
                LocalDate.of(2027, 2, 28), Arrays.stream(DayOfWeek.values())
                        .map(day -> new WeeklyOpeningHours(day, LocalTime.of(9, 0), LocalTime.of(17, 0))).toList());
        AvailabilityChange.PeriodStored season = events.stream(AvailabilityChange.PeriodStored.class).toList().getLast();

        // when
        Object stored = serializer.serialize(season);
        Object read = serializer.deserialize(stored, AvailabilityChange.PeriodStored.class);

        // then
        assertThat(stored.toString()).as("event_publication keeps a failed delivery, so it holds no text members never see")
                .doesNotContain(BOARD_NOTE);
        assertThat(read).as("a publication the registry cannot read back is lost on resubmission").isEqualTo(season);
    }
}
