package org.courtside.facility;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.internal.CourtRepository;
import org.courtside.facility.internal.WeeklyOpeningHours;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AvailabilityServiceTest extends AbstractIntegrationTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 5, 12);
    private static final LocalTime EIGHT = LocalTime.of(8, 0);
    private static final LocalTime NINE_PM = LocalTime.of(21, 0);

    @Autowired
    private FacilityService facility;

    @Autowired
    private CourtRepository courts;

    @Test
    void givenASummerSeason_whenReadingADayInsideIt_thenTheScheduleUsesItsHours() {
        // when
        OpeningPeriod season = facility.createOpeningPeriod(OpeningPeriod.Kind.SEASON, " Summer ",
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 9, 30), every(EIGHT, NINE_PM));

        // then
        assertThat(season.name()).as("the name is stored trimmed").isEqualTo("Summer");
        assertThat(facility.openingSchedule().windowOn(LocalDate.of(2026, 7, 7)))
                .contains(new OpeningWindow(EIGHT, NINE_PM));
        assertThat(facility.openingPeriods()).extracting(OpeningPeriod::id).containsExactly(season.id());
    }

    @Test
    void givenASeason_whenASecondSeasonOverlapsIt_thenTheOverlapIsRefused() {
        // given
        facility.createOpeningPeriod(OpeningPeriod.Kind.SEASON, "Summer",
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 9, 30), every(EIGHT, NINE_PM));

        // when / then
        assertThatThrownBy(() -> facility.createOpeningPeriod(OpeningPeriod.Kind.SEASON, "Autumn",
                LocalDate.of(2026, 9, 30), LocalDate.of(2026, 10, 31), every(EIGHT, NINE_PM)))
                .isInstanceOfSatisfying(AvailabilityRejectedException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("facility.availability.overlap"));
    }

    @Test
    void givenASeason_whenAHolidayLiesInsideIt_thenBothAreKept() {
        // given
        facility.createOpeningPeriod(OpeningPeriod.Kind.SEASON, "Summer",
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 9, 30), every(EIGHT, NINE_PM));

        // when
        facility.createOpeningPeriod(OpeningPeriod.Kind.HOLIDAY, "Founding day",
                LocalDate.of(2026, 7, 7), LocalDate.of(2026, 7, 7), closedWeek());

        // then
        assertThat(facility.openingSchedule().windowOn(LocalDate.of(2026, 7, 7)))
                .as("the closed holiday wins over the season").isEmpty();
    }

    @Test
    void givenAPeriodThatEndedYesterday_whenItIsCreated_thenTheHistoryIsKept() {
        // when / then
        assertThatThrownBy(() -> facility.createOpeningPeriod(OpeningPeriod.Kind.HOLIDAY, "Past",
                TODAY.minusDays(3), TODAY.minusDays(1), closedWeek()))
                .isInstanceOfSatisfying(AvailabilityRejectedException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("facility.availability.ended"));
    }

    @Test
    void givenAPeriod_whenItsLastDayLiesBeforeItsFirst_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> facility.createOpeningPeriod(OpeningPeriod.Kind.SEASON, "Backwards",
                LocalDate.of(2026, 9, 30), LocalDate.of(2026, 6, 1), every(EIGHT, NINE_PM)))
                .isInstanceOfSatisfying(AvailabilityRejectedException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("facility.availability.endsBeforeStart"));
    }

    @Test
    void givenAPeriodWithoutAName_whenItIsCreated_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> facility.createOpeningPeriod(OpeningPeriod.Kind.SEASON, "  ",
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 9, 30), every(EIGHT, NINE_PM)))
                .isInstanceOfSatisfying(AvailabilityRejectedException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("facility.availability.nameRequired"));
    }

    @Test
    void givenHoursOffTheBookingGrid_whenASeasonIsCreated_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> facility.createOpeningPeriod(OpeningPeriod.Kind.SEASON, "Summer",
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 9, 30), every(LocalTime.of(8, 7), NINE_PM)))
                .isInstanceOf(WeeklyOpeningHoursRejectedException.class);
        assertThat(facility.openingPeriods()).isEmpty();
    }

    @Test
    void givenASeason_whenItIsChangedAndRemoved_thenTheWeeklyHoursGovernAgain() {
        // given
        OpeningPeriod season = facility.createOpeningPeriod(OpeningPeriod.Kind.SEASON, "Summer",
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 9, 30), every(EIGHT, NINE_PM));

        // when
        OpeningPeriod changed = facility.changeOpeningPeriod(season.id(), "Long summer",
                LocalDate.of(2026, 5, 15), LocalDate.of(2026, 10, 15), closedWeek());

        // then
        assertThat(changed.name()).isEqualTo("Long summer");
        assertThat(facility.openingSchedule().windowOn(LocalDate.of(2026, 10, 14)))
                .as("a season without hours closes its days").isEmpty();

        // when
        facility.removeOpeningPeriod(season.id());

        // then
        assertThat(facility.openingPeriods()).isEmpty();
    }

    @Test
    void givenACourt_whenItIsClosedForAMonth_thenTheClosureIsListedAndAnOverlapRefused() {
        // given
        Court court = courts.save(new Court(4, null));

        // when
        CourtClosure closure = facility.createCourtClosure(court.getId(), "Resurfacing",
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 30));

        // then
        assertThat(facility.courtClosures()).containsExactly(closure);
        assertThatThrownBy(() -> facility.createCourtClosure(court.getId(), "Lights",
                LocalDate.of(2026, 6, 30), LocalDate.of(2026, 7, 2)))
                .isInstanceOfSatisfying(AvailabilityRejectedException.class, failure ->
                        assertThat(failure.getCode()).isEqualTo("facility.availability.overlap"));
    }

    @Test
    void givenTwoCourts_whenEachIsClosedOnTheSameDays_thenBothClosuresAreKept() {
        // given
        Court first = courts.save(new Court(4, null));
        Court second = courts.save(new Court(5, null));

        // when
        facility.createCourtClosure(first.getId(), "Resurfacing", LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 30));
        facility.createCourtClosure(second.getId(), "Resurfacing", LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 30));

        // then
        assertThat(facility.courtClosures()).hasSize(2);
    }

    @Test
    void givenAClosure_whenItIsChangedAndRemoved_thenTheListFollows() {
        // given
        Court court = courts.save(new Court(4, null));
        CourtClosure closure = facility.createCourtClosure(court.getId(), "Resurfacing",
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 30));

        // when
        CourtClosure changed = facility.changeCourtClosure(closure.id(), "Resurfacing late",
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 31));

        // then
        assertThat(changed.startsOn()).isEqualTo(LocalDate.of(2026, 7, 1));

        // when
        facility.removeCourtClosure(closure.id());

        // then
        assertThat(facility.courtClosures()).isEmpty();
        assertThatThrownBy(() -> facility.removeCourtClosure(closure.id()))
                .isInstanceOf(AvailabilityEntryNotFoundException.class);
    }

    private static List<WeeklyOpeningHours> every(LocalTime opensAt, LocalTime closesAt) {
        return Arrays.stream(DayOfWeek.values()).map(day -> new WeeklyOpeningHours(day, opensAt, closesAt)).toList();
    }

    private static List<WeeklyOpeningHours> closedWeek() {
        return Arrays.stream(DayOfWeek.values()).map(day -> new WeeklyOpeningHours(day, null, null)).toList();
    }
}
